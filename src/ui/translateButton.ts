/**
 * Translation controls + translation flow — the ONLY translate triggers.
 *
 * Two surfaces drive the same state, both acting on the active reading view:
 *   - Status bar (desktop): ① Translate / Show-original ② display-mode toggle.
 *   - FAB (floating button inside the reading view, bottom-right): the mobile
 *     entry point (mobile has no status bar); visibility is a setting.
 *
 * First click translates the whole note; once translated, it toggles between
 * showing the translation and the original (a CSS class swap — no re-request).
 *
 * Obsidian's reading view is VIRTUALIZED (off-screen blocks aren't in the live
 * DOM), so one click: translates on-screen blocks immediately; pre-translates
 * the whole note into the cache by rendering its source off-screen; and a
 * MutationObserver injects cached translations into each block the instant it
 * renders on scroll. Shell file (imports obsidian/DOM) — never imported by tests.
 */
import { MarkdownView, Notice, Platform, setIcon } from "obsidian";
import type { App, Component } from "obsidian";
import {
  applyDisplayMode,
  applyTranslationStyle,
  clearTranslations,
  collectSourceBlockTexts,
  collectTranslatableBlocks,
  injectTranslation,
  setBlockLoading,
  CollectedBlock,
  InjectContext,
  SHOW_SOURCE_CLASS,
  TRANSLATION_CLASS,
} from "../render/postProcessor";
import { isLikelyTargetLanguage } from "../core/blockRules";
import { chunkByBudget, Segment } from "../core/segmentation";
import { runPool } from "../core/rateLimiter";
import { createProvider } from "../translator/factory";
import { HttpClient, AuthError, TranslationProvider } from "../translator/provider";
import { TranslationCache } from "../translator/cache";
import { DisplayMode, InterlinearSettings, isConfigured, cacheIdentity, getActivePresetSettings } from "../settings";

const REVEAL_OFF_CLASS = "it-reveal-off"; // on container: hide translations, show originals
const SYNC_DEBOUNCE_MS = 120;

interface FileState {
  active: boolean; // translation has been run for this note
  revealed: boolean; // translations currently shown (vs "show original")
  mode: DisplayMode;
}

interface ActiveReading {
  view: MarkdownView;
  container: HTMLElement;
  path: string;
}

export interface TranslationControllerDeps {
  app: App;
  /** The plugin, used as the Component for DOM-event/registration lifecycle. */
  component: Component;
  http: HttpClient;
  getSettings: () => InterlinearSettings;
  cache: TranslationCache;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class TranslationController {
  private readonly app: App;
  private readonly component: Component;
  private readonly http: HttpClient;
  private readonly getSettings: () => InterlinearSettings;
  private readonly cache: TranslationCache;

  private readonly fileStates = new Map<string, FileState>();
  /** In-flight translation flows per note (visible-sync + whole-doc may overlap). */
  private readonly busyCount = new Map<string, number>();
  /** Batch progress per note while busy ("Translating done/total…"). */
  private readonly progress = new Map<string, { done: number; total: number }>();
  private readonly syncing = new Set<string>();
  private readonly failedTexts = new Map<string, Set<string>>();
  /** Containers that already have the tap-to-reveal listener (mobile). */
  private readonly tapBound = new WeakSet<HTMLElement>();

  private observer: MutationObserver | null = null;
  private observedEl: HTMLElement | null = null;
  private syncTimer: number | null = null;

  // Status-bar UI
  private translateBtn: HTMLElement | null = null;
  private translateIconEl: HTMLElement | null = null;
  private translateLabelEl: HTMLElement | null = null;
  private modeBtn: HTMLElement | null = null;
  private modeIconEl: HTMLElement | null = null;
  private modeLabelEl: HTMLElement | null = null;

  // FAB UI (created lazily, mounted into the active reading view)
  private fabEl: HTMLElement | null = null;
  private fabMainBtn: HTMLElement | null = null;
  private fabMainIcon: HTMLElement | null = null;
  private fabProgressEl: HTMLElement | null = null;
  private fabModeBtn: HTMLElement | null = null;
  private fabModeIcon: HTMLElement | null = null;

  constructor(deps: TranslationControllerDeps) {
    this.app = deps.app;
    this.component = deps.component;
    this.http = deps.http;
    this.getSettings = deps.getSettings;
    this.cache = deps.cache;
  }

  /** Build the two status-bar buttons inside the given status-bar item element. */
  mountStatusBar(el: HTMLElement): void {
    el.addClass("it-statusbar");

    this.modeBtn = el.createEl("span", { cls: "it-sb-btn it-sb-mode" });
    this.modeIconEl = this.modeBtn.createSpan({ cls: "it-sb-icon" });
    this.modeLabelEl = this.modeBtn.createSpan({ cls: "it-sb-label" });
    this.component.registerDomEvent(this.modeBtn, "click", () => this.toggleMode());

    this.translateBtn = el.createEl("span", { cls: "it-sb-btn it-sb-translate" });
    this.translateIconEl = this.translateBtn.createSpan({ cls: "it-sb-icon" });
    this.translateLabelEl = this.translateBtn.createSpan({ cls: "it-sb-label" });
    this.component.registerDomEvent(this.translateBtn, "click", () => this.toggleTranslate());

    this.paint();
  }

  /** Refresh observer + FAB + status bar when the active leaf/layout changes. */
  syncActiveView(): void {
    const active = this.getActiveReading();
    if (active && this.stateFor(active.path).active) {
      this.observe(active.container);
      // Re-assert the container classes (also picks up settings changes, e.g.
      // a new translation style) — pure class work, never a request.
      this.applyView(active, this.stateFor(active.path));
      this.scheduleSync(); // re-inject cached translations when returning to the note
    }
    this.syncFab(active);
    this.paint();
  }

  /** Button ①/⌥A: translate, or toggle translation ↔ original once translated. */
  toggleTranslate(): void {
    const active = this.getActiveReading();
    if (!active) {
      new Notice("Open a note in reading view to use Interlinear.");
      return;
    }
    const st = this.stateFor(active.path);
    if (!st.active) {
      this.activate(active);
    } else if ((this.failedTexts.get(active.path)?.size ?? 0) > 0) {
      // Blocks failed last time — re-triggering retries them (as the status/
      // notice messages promise) instead of toggling translation ↔ original.
      this.retryFailed(active, st);
    } else {
      st.revealed = !st.revealed;
      this.applyView(active, st);
      this.paint();
    }
  }

  /** Button ②: toggle bilingual ↔ translation-only (display effect only). */
  toggleMode(): void {
    const active = this.getActiveReading();
    if (!active) {
      new Notice("Open a note in reading view to use Interlinear.");
      return;
    }
    const st = this.stateFor(active.path);
    st.mode = st.mode === "bilingual" ? "translation-only" : "bilingual";
    if (st.active && st.revealed) {
      applyDisplayMode(active.container, st.mode);
    }
    this.paint();
  }

  /**
   * The translation config changed (edited in settings, or synced in via
   * onExternalSettingsChange). Drop every note's "failed/skip" set so blocks
   * that failed under the old config (e.g. a wrong key/endpoint) are eligible
   * again, then let the ALREADY-ACTIVE note re-attempt them. Only active notes
   * (ones the user already chose to translate) re-sync — opening/switching a
   * note still never translates on its own (hard constraint #1).
   */
  onProviderConfigChanged(): void {
    this.failedTexts.clear();
    // scheduleSync only re-runs when the active note is already `active`.
    this.scheduleSync();
    this.paint();
  }

  clearActiveView(): void {
    const active = this.getActiveReading();
    if (!active) return;
    const st = this.stateFor(active.path);
    st.active = false;
    st.revealed = false;
    this.failedTexts.delete(active.path);
    if (this.observedEl === active.container) {
      this.observer?.disconnect();
      this.observedEl = null;
    }
    clearTranslations(active.container);
    active.container.removeClass(REVEAL_OFF_CLASS);
    this.paint();
  }

  // --- internals -----------------------------------------------------------

  private getActiveReading(): ActiveReading | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() !== "preview") return null;
    const path = view.file?.path;
    if (!path) return null;
    return { view, container: view.previewMode.containerEl, path };
  }

  private stateFor(path: string): FileState {
    let st = this.fileStates.get(path);
    if (!st) {
      st = { active: false, revealed: false, mode: this.getSettings().defaultDisplayMode };
      this.fileStates.set(path, st);
    }
    return st;
  }

  private failedTextsFor(path: string): Set<string> {
    let s = this.failedTexts.get(path);
    if (!s) {
      s = new Set();
      this.failedTexts.set(path, s);
    }
    return s;
  }

  private activate(active: ActiveReading): void {
    if (!this.ensureConfigured()) return;
    const st = this.stateFor(active.path);
    st.active = true;
    st.revealed = true;
    this.observe(active.container);
    this.applyView(active, st);
    this.paint();
    this.runTranslation(active, st);
  }

  /** Re-trigger after a partial failure: retry the blocks that failed last time
   *  (the status/notice messages promise this) rather than toggling reveal. */
  private retryFailed(active: ActiveReading, st: FileState): void {
    if (!this.ensureConfigured()) return;
    st.revealed = true; // surface the retried translations
    this.observe(active.container);
    this.applyView(active, st);
    this.paint();
    this.runTranslation(active, st);
  }

  /** Clear the failed-block set and (re)run the visible + whole-doc flows. */
  private runTranslation(active: ActiveReading, st: FileState): void {
    this.failedTexts.delete(active.path); // re-attempt previously-failed blocks
    void this.syncVisible(active, st);
    void this.pretranslateWholeDoc(active);
  }

  private ensureConfigured(): boolean {
    if (isConfigured(this.getSettings())) return true;
    new Notice("Configure the selected translation service in Interlinear settings first.");
    return false;
  }

  /** Chunk segments within BOTH the user's batch tuning and the provider's
   *  hard per-request caps (traditional MT services take fewer/smaller
   *  batches than the LLM path — some exactly one segment per request). */
  private chunkForProvider(segments: Segment[], settings: InterlinearSettings, provider: TranslationProvider): Segment[][] {
    const activePreset = getActivePresetSettings(settings);
    const maxChars = Math.min(activePreset.batchCharBudget, provider.maxCharsPerRequest ?? Infinity);
    const maxSegments = Math.min(activePreset.maxSegmentsPerBatch, provider.maxSegmentsPerRequest ?? Infinity);
    return chunkByBudget(segments, maxChars, maxSegments);
  }

  /** Apply reveal (translation vs original) + display mode + style via container classes. */
  private applyView(active: ActiveReading, st: FileState): void {
    active.container.toggleClass(REVEAL_OFF_CLASS, !st.revealed);
    applyDisplayMode(active.container, st.mode);
    applyTranslationStyle(active.container, this.getSettings().translationStyle);
  }

  private observe(container: HTMLElement): void {
    this.bindTapReveal(container);
    if (!this.observer) {
      this.observer = new MutationObserver(() => this.scheduleSync());
      this.component.register(() => this.observer?.disconnect());
    }
    if (this.observedEl === container) return;
    this.observer.disconnect();
    this.observer.observe(container, { childList: true, subtree: true });
    this.observedEl = container;
  }

  /** Mobile has no hover: tapping a translation toggles its hover-equivalent
   *  class — reveals the original (translation-only mode) and lifts the
   *  learning-mask blur. Pure class work — never triggers a request. */
  private bindTapReveal(container: HTMLElement): void {
    if (!Platform.isMobile || this.tapBound.has(container)) return;
    this.tapBound.add(container);
    this.component.registerDomEvent(container, "click", (evt) => {
      const target = evt.target instanceof HTMLElement ? evt.target : null;
      const block = target?.closest(`.${TRANSLATION_CLASS}`);
      if (block instanceof HTMLElement) {
        block.toggleClass(SHOW_SOURCE_CLASS, !block.hasClass(SHOW_SOURCE_CLASS));
      }
    });
  }

  private scheduleSync(): void {
    if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = null;
      const active = this.getActiveReading();
      if (active && this.stateFor(active.path).active) {
        void this.syncVisible(active, this.stateFor(active.path));
      }
    }, SYNC_DEBOUNCE_MS);
  }

  /** Translate/inject the blocks currently on screen (cache hits instant; misses
   *  translated once). Serialized per note so observer ticks can't double-run. */
  private async syncVisible(active: ActiveReading, st: FileState): Promise<void> {
    if (!st.active) return;
    if (this.syncing.has(active.path)) {
      this.scheduleSync();
      return;
    }
    const failed = this.failedTexts.get(active.path);
    const targetLang = this.getSettings().targetLang;
    const blocks = collectTranslatableBlocks(active.container).filter((b) => {
      const sib = b.el.nextElementSibling;
      if (sib && sib.hasClass(TRANSLATION_CLASS)) return false;
      if (failed && failed.has(b.descriptor.text)) return false;
      if (isLikelyTargetLanguage(b.descriptor.text, targetLang)) return false; // already target lang
      return true;
    });
    if (blocks.length === 0) return;

    this.syncing.add(active.path);
    this.busyStart(active.path);
    try {
      await this.translateBatch(blocks, active.container, active.path, this.getSettings(), st);
    } catch (err) {
      new Notice("Translation failed: " + errorMessage(err));
    } finally {
      this.syncing.delete(active.path);
      this.busyEnd(active.path);
    }
  }

  private async pretranslateWholeDoc(active: ActiveReading): Promise<void> {
    const settings = this.getSettings();
    if (!isConfigured(settings)) return;

    let texts: string[];
    try {
      texts = await collectSourceBlockTexts(
        this.app,
        active.view.getViewData(),
        active.view.contentEl,
        this.component
      );
    } catch {
      return;
    }

    const cacheId = cacheIdentity(settings);
    const { targetLang } = settings;
    // Skip blocks already written in the target language (no request needed).
    const translatable = texts.filter((t) => !isLikelyTargetLanguage(t, targetLang));
    if (translatable.length === 0) {
      new Notice("Already in the target language — nothing to translate.");
      return;
    }
    const misses = translatable.filter((t) => this.cache.get(t, cacheId, targetLang) === undefined);
    if (misses.length === 0) {
      await this.syncVisible(active, this.stateFor(active.path));
      return;
    }

    this.busyStart(active.path);
    try {
      const segments: Segment[] = misses.map((text, index) => ({ index, text }));
      const provider = createProvider(settings, this.http);
      const chunks = this.chunkForProvider(segments, settings, provider);
      this.addProgressTotal(active.path, chunks.length);

      const tasks = chunks.map((chunk) => async () => {
        const translations = await provider.translate(chunk.map((s) => s.text));
        this.bumpProgressDone(active.path);
        return chunk.map((s, j) => ({ text: s.text, translated: translations[j] }));
      });

      const tuning = getActivePresetSettings(settings);
      const results = await runPool(tasks, {
        concurrency: tuning.concurrency,
        minIntervalMs: tuning.minIntervalMs,
        maxRetries: tuning.maxRetries,
      });

      let authFailed = false;
      let failed = 0;
      let firstError: unknown;
      for (const result of results) {
        if (!result.ok) {
          failed++;
          firstError ??= result.error;
          if (result.error instanceof AuthError) authFailed = true;
          console.warn("Interlinear: whole-note batch failed:", result.error);
          continue;
        }
        for (const { text, translated } of result.value) {
          this.cache.set(text, cacheId, targetLang, translated);
        }
      }

      if (authFailed) new Notice("Authentication failed — check your API key.");
      else if (failed > 0)
        new Notice(
          `Whole-note translation: ${failed} batch(es) failed (${errorMessage(firstError)}) — trigger again to retry.`
        );
    } finally {
      this.busyEnd(active.path);
    }

    await this.syncVisible(active, this.stateFor(active.path));
  }

  private async translateBatch(
    blocks: CollectedBlock[],
    container: HTMLElement | null,
    path: string,
    settings: InterlinearSettings,
    st: FileState
  ): Promise<void> {
    const cacheId = cacheIdentity(settings);
    const { targetLang } = settings;
    const ctx: InjectContext = { app: this.app, sourcePath: path, component: this.component };

    const misses: Array<{ el: HTMLElement; text: string }> = [];
    for (const block of blocks) {
      const text = block.descriptor.text;
      const cached = this.cache.get(text, cacheId, targetLang);
      if (cached !== undefined) {
        await injectTranslation(block.el, cached, ctx);
      } else {
        misses.push({ el: block.el, text });
      }
    }
    if (container) applyDisplayMode(container, st.mode);
    if (misses.length === 0) return;

    for (const miss of misses) setBlockLoading(miss.el, true);

    const segments: Segment[] = misses.map((m, k) => ({ index: k, text: m.text }));
    const provider = createProvider(settings, this.http);
    const chunks = this.chunkForProvider(segments, settings, provider);
    this.addProgressTotal(path, chunks.length);

    // Each task injects its blocks (and clears their spinners) as it completes.
    const tasks = chunks.map((chunk) => async () => {
      const translations = await provider.translate(chunk.map((s) => s.text));
      this.bumpProgressDone(path);
      for (let j = 0; j < chunk.length; j++) {
        const miss = misses[chunk[j].index];
        this.cache.set(miss.text, cacheId, targetLang, translations[j]);
        await injectTranslation(miss.el, translations[j], ctx);
        setBlockLoading(miss.el, false);
      }
    });

    const tuning = getActivePresetSettings(settings);
    const results = await runPool(tasks, {
      concurrency: tuning.concurrency,
      minIntervalMs: tuning.minIntervalMs,
      maxRetries: tuning.maxRetries,
    });

    const failedSet = this.failedTextsFor(path);
    let authFailed = false;
    let failed = 0;
    let firstError: unknown;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result.ok) {
        failed++;
        firstError ??= result.error;
        if (result.error instanceof AuthError) authFailed = true;
        console.warn("Interlinear: batch failed:", result.error);
        for (const s of chunks[i]) {
          setBlockLoading(misses[s.index].el, false);
          failedSet.add(s.text);
        }
      }
    }

    if (container) applyDisplayMode(container, st.mode);
    if (authFailed) new Notice("Authentication failed — check your API key.");
    else if (failed > 0)
      new Notice(`${failed} batch(es) failed (${errorMessage(firstError)}) — trigger again to retry.`);
  }

  // --- busy / progress accounting -------------------------------------------

  private isBusy(path: string): boolean {
    return (this.busyCount.get(path) ?? 0) > 0;
  }

  private busyStart(path: string): void {
    this.busyCount.set(path, (this.busyCount.get(path) ?? 0) + 1);
    this.paint();
  }

  private busyEnd(path: string): void {
    const n = (this.busyCount.get(path) ?? 1) - 1;
    if (n <= 0) {
      this.busyCount.delete(path);
      this.progress.delete(path); // last flow finished — progress is over
    } else {
      this.busyCount.set(path, n);
    }
    this.paint();
  }

  private addProgressTotal(path: string, batches: number): void {
    const p = this.progress.get(path) ?? { done: 0, total: 0 };
    p.total += batches;
    this.progress.set(path, p);
    this.paint();
  }

  private bumpProgressDone(path: string): void {
    const p = this.progress.get(path);
    if (!p) return;
    p.done++;
    this.paint();
  }

  // --- FAB (in-view floating button — the mobile entry point) ---------------

  private fabVisible(): boolean {
    const v = this.getSettings().showFab;
    if (v === "never") return false;
    if (v === "mobile") return Platform.isMobile;
    return true;
  }

  private ensureFab(): HTMLElement {
    if (this.fabEl) return this.fabEl;
    const fab = createDiv({ cls: "it-fab" });

    this.fabModeBtn = fab.createDiv({
      cls: "it-fab-btn it-fab-mode",
      attr: { "aria-label": "Toggle display mode", role: "button" },
    });
    this.fabModeIcon = this.fabModeBtn.createSpan({ cls: "it-fab-icon" });
    this.component.registerDomEvent(this.fabModeBtn, "click", (evt) => {
      evt.stopPropagation();
      this.toggleMode();
    });

    this.fabMainBtn = fab.createDiv({
      cls: "it-fab-btn it-fab-main",
      attr: { "aria-label": "Translate / show original", role: "button" },
    });
    this.fabMainIcon = this.fabMainBtn.createSpan({ cls: "it-fab-icon" });
    this.fabProgressEl = this.fabMainBtn.createSpan({ cls: "it-fab-progress" });
    this.component.registerDomEvent(this.fabMainBtn, "click", (evt) => {
      evt.stopPropagation();
      this.toggleTranslate();
    });

    this.component.register(() => {
      fab.remove();
      this.fabEl = null;
    });
    this.fabEl = fab;
    return fab;
  }

  /** Keep the FAB mounted inside the active reading view (or detached). */
  private syncFab(active: ActiveReading | null): void {
    if (!active || !this.fabVisible()) {
      this.fabEl?.remove();
      return;
    }
    const fab = this.ensureFab();
    if (fab.parentElement !== active.view.containerEl) {
      active.view.containerEl.appendChild(fab);
    }
  }

  // --- painting --------------------------------------------------------------

  /** Repaint every control (status bar + FAB) from the current state. */
  private paint(): void {
    const active = this.getActiveReading();
    const st = active ? this.stateFor(active.path) : null;
    const inReading = active !== null;
    const busy = active ? this.isBusy(active.path) : false;
    const prog = active ? this.progress.get(active.path) : undefined;
    const progressText = busy && prog && prog.total > 0 ? `${prog.done}/${prog.total}` : null;
    const mainIcon = busy ? "loader" : st?.active && st.revealed ? "book-open" : "languages";
    const modeIcon = st?.mode === "translation-only" ? "align-justify" : "columns-2";
    const modeUsable = st !== null && st.active && st.revealed;

    // Status bar
    if (this.translateBtn && this.modeBtn) {
      if (this.translateIconEl) setIcon(this.translateIconEl, mainIcon);
      if (this.translateLabelEl) {
        this.translateLabelEl.textContent = busy
          ? `Translating${progressText ? ` ${progressText}` : ""}…`
          : !st || !st.active
            ? "Translate"
            : st.revealed
              ? "Translated"
              : "Original";
      }
      this.translateBtn.toggleClass("is-disabled", !inReading);
      this.translateBtn.toggleClass("is-busy", busy);

      if (this.modeIconEl) setIcon(this.modeIconEl, modeIcon);
      if (this.modeLabelEl) {
        this.modeLabelEl.textContent = st?.mode === "translation-only" ? "Translation only" : "Bilingual";
      }
      this.modeBtn.toggleClass("is-disabled", !modeUsable);
    }

    // FAB
    if (this.fabEl) {
      if (this.fabMainIcon) setIcon(this.fabMainIcon, mainIcon);
      this.fabMainBtn?.toggleClass("is-busy", busy);
      if (this.fabProgressEl) this.fabProgressEl.textContent = progressText ?? "";
      this.fabEl.toggleClass("has-progress", progressText !== null);
      if (this.fabModeIcon) setIcon(this.fabModeIcon, modeIcon);
      this.fabModeBtn?.toggleClass("it-fab-hidden", !modeUsable);
    }
  }
}
