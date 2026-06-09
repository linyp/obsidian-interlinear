/**
 * Status-bar translation controls + translation flow — the ONLY translate trigger.
 *
 * Two buttons live in Obsidian's (global) status bar and act on the active
 * reading view:
 *   1. Translate / Show-original (⌥A): first click translates the whole note;
 *      once translated, it toggles between showing the translation and the
 *      original (a CSS class swap — no re-request).
 *   2. Display mode: bilingual (original + translation) vs translation-only.
 *
 * Obsidian's reading view is VIRTUALIZED (off-screen blocks aren't in the live
 * DOM), so one click: translates on-screen blocks immediately; pre-translates
 * the whole note into the cache by rendering its source off-screen; and a
 * MutationObserver injects cached translations into each block the instant it
 * renders on scroll. Shell file (imports obsidian/DOM) — never imported by tests.
 */
import { MarkdownView, Notice, setIcon } from "obsidian";
import type { App, Component } from "obsidian";
import {
  applyDisplayMode,
  clearTranslations,
  collectSourceBlockTexts,
  collectTranslatableBlocks,
  injectTranslation,
  setBlockLoading,
  CollectedBlock,
  InjectContext,
  TRANSLATION_CLASS,
} from "../render/postProcessor";
import { chunkByBudget, Segment } from "../core/segmentation";
import { runPool } from "../core/rateLimiter";
import { DeepSeekProvider } from "../translator/deepseek";
import { HttpClient, AuthError } from "../translator/provider";
import { TranslationCache } from "../translator/cache";
import { DisplayMode, InterlinearSettings, isConfigured, toProviderConfig } from "../settings";

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
  private readonly flushing = new Set<string>();
  private readonly syncing = new Set<string>();
  private readonly failedTexts = new Map<string, Set<string>>();

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

    this.paintStatusBar();
  }

  /** Refresh observer + status bar when the active leaf/layout changes. */
  syncActiveView(): void {
    const active = this.getActiveReading();
    if (active && this.stateFor(active.path).active) {
      this.observe(active.container);
      this.scheduleSync(); // re-inject cached translations when returning to the note
    }
    this.paintStatusBar();
  }

  /** Button ①/⌥A: translate, or toggle translation ↔ original once translated. */
  toggleTranslate(): void {
    const active = this.getActiveReading();
    if (!active) {
      new Notice("请在阅读模式下使用 Interlinear");
      return;
    }
    const st = this.stateFor(active.path);
    if (!st.active) {
      this.activate(active);
    } else {
      st.revealed = !st.revealed;
      this.applyView(active, st);
      new Notice(st.revealed ? "显示译文" : "显示原文");
      this.paintStatusBar();
    }
  }

  /** Button ②: toggle bilingual ↔ translation-only (display effect only). */
  toggleMode(): void {
    const active = this.getActiveReading();
    if (!active) {
      new Notice("请在阅读模式下使用 Interlinear");
      return;
    }
    const st = this.stateFor(active.path);
    st.mode = st.mode === "bilingual" ? "translation-only" : "bilingual";
    if (st.active && st.revealed) {
      applyDisplayMode(active.container, st.mode);
      new Notice(st.mode === "bilingual" ? "双语对照" : "仅译文");
    }
    this.paintStatusBar();
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
    this.paintStatusBar();
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
    if (!isConfigured(this.getSettings())) {
      new Notice("请先在设置中填写 DeepSeek API key");
      return;
    }
    const st = this.stateFor(active.path);
    const firstActivation = !st.active;
    st.active = true;
    st.revealed = true;
    this.failedTexts.delete(active.path); // re-click retries previously-failed blocks
    this.observe(active.container);
    this.applyView(active, st);
    this.paintStatusBar();
    if (firstActivation) new Notice("正在翻译整篇…");

    void this.syncVisible(active, st);
    void this.pretranslateWholeDoc(active);
  }

  /** Apply reveal (translation vs original) + display mode via container classes. */
  private applyView(active: ActiveReading, st: FileState): void {
    active.container.toggleClass(REVEAL_OFF_CLASS, !st.revealed);
    applyDisplayMode(active.container, st.mode);
  }

  private observe(container: HTMLElement): void {
    if (!this.observer) {
      this.observer = new MutationObserver(() => this.scheduleSync());
      this.component.register(() => this.observer?.disconnect());
    }
    if (this.observedEl === container) return;
    this.observer.disconnect();
    this.observer.observe(container, { childList: true, subtree: true });
    this.observedEl = container;
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
    const blocks = collectTranslatableBlocks(active.container).filter((b) => {
      const sib = b.el.nextElementSibling;
      if (sib && sib.hasClass(TRANSLATION_CLASS)) return false;
      if (failed && failed.has(b.descriptor.text)) return false;
      return true;
    });
    if (blocks.length === 0) return;

    this.syncing.add(active.path);
    this.flushing.add(active.path);
    this.paintStatusBar();
    try {
      await this.translateBatch(blocks, active.container, active.path, this.getSettings(), st);
    } catch (err) {
      new Notice("翻译失败：" + errorMessage(err));
    } finally {
      this.syncing.delete(active.path);
      this.flushing.delete(active.path);
      this.paintStatusBar();
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

    const { model, targetLang } = settings;
    const misses = texts.filter((t) => this.cache.get(t, model, targetLang) === undefined);
    if (misses.length === 0) {
      await this.syncVisible(active, this.stateFor(active.path));
      return;
    }

    this.flushing.add(active.path);
    this.paintStatusBar();
    try {
      const segments: Segment[] = misses.map((text, index) => ({ index, text }));
      const chunks = chunkByBudget(segments, settings.batchCharBudget);
      const provider = new DeepSeekProvider({ config: toProviderConfig(settings), http: this.http });

      const tasks = chunks.map((chunk) => async () => {
        const translations = await provider.translate(chunk.map((s) => s.text));
        return chunk.map((s, j) => ({ text: s.text, translated: translations[j] }));
      });

      const results = await runPool(tasks, {
        concurrency: settings.concurrency,
        minIntervalMs: settings.minIntervalMs,
        maxRetries: settings.maxRetries,
      });

      let authFailed = false;
      let failed = 0;
      for (const result of results) {
        if (!result.ok) {
          failed++;
          if (result.error instanceof AuthError) authFailed = true;
          continue;
        }
        for (const { text, translated } of result.value) {
          this.cache.set(text, model, targetLang, translated);
        }
      }

      if (authFailed) new Notice("DeepSeek 鉴权失败，请检查 API key");
      else if (failed > 0) new Notice(`整篇翻译有 ${failed} 批失败，可重新触发重试`);
      else new Notice("整篇已翻译，向下滚动即可即时显示");
    } finally {
      this.flushing.delete(active.path);
      this.paintStatusBar();
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
    const { model, targetLang } = settings;
    const ctx: InjectContext = { app: this.app, sourcePath: path, component: this.component };

    const misses: Array<{ el: HTMLElement; text: string }> = [];
    for (const block of blocks) {
      const text = block.descriptor.text;
      const cached = this.cache.get(text, model, targetLang);
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
    const chunks = chunkByBudget(segments, settings.batchCharBudget);
    const provider = new DeepSeekProvider({ config: toProviderConfig(settings), http: this.http });

    // Each task injects its blocks (and clears their spinners) as it completes.
    const tasks = chunks.map((chunk) => async () => {
      const translations = await provider.translate(chunk.map((s) => s.text));
      for (let j = 0; j < chunk.length; j++) {
        const miss = misses[chunk[j].index];
        this.cache.set(miss.text, model, targetLang, translations[j]);
        await injectTranslation(miss.el, translations[j], ctx);
        setBlockLoading(miss.el, false);
      }
    });

    const results = await runPool(tasks, {
      concurrency: settings.concurrency,
      minIntervalMs: settings.minIntervalMs,
      maxRetries: settings.maxRetries,
    });

    const failedSet = this.failedTextsFor(path);
    let authFailed = false;
    let failed = 0;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result.ok) {
        failed++;
        if (result.error instanceof AuthError) authFailed = true;
        for (const s of chunks[i]) {
          setBlockLoading(misses[s.index].el, false);
          failedSet.add(s.text);
        }
      }
    }

    if (container) applyDisplayMode(container, st.mode);
    if (authFailed) new Notice("DeepSeek 鉴权失败，请检查 API key");
    else if (failed > 0) new Notice(`有 ${failed} 批内容翻译失败，可重新触发以重试`);
  }

  private paintStatusBar(): void {
    if (!this.translateBtn || !this.modeBtn) return;
    const active = this.getActiveReading();
    const st = active ? this.stateFor(active.path) : null;
    const inReading = active !== null;
    const busy = active ? this.flushing.has(active.path) : false;

    // Translate / show-original button
    if (this.translateIconEl) {
      setIcon(this.translateIconEl, busy ? "loader" : st?.active && st.revealed ? "book-open" : "languages");
    }
    if (this.translateLabelEl) {
      this.translateLabelEl.textContent = !st || !st.active ? "翻译" : st.revealed ? "显示原文" : "显示译文";
    }
    this.translateBtn.toggleClass("is-disabled", !inReading);
    this.translateBtn.toggleClass("is-busy", busy);

    // Display-mode button
    const modeUsable = st !== null && st.active && st.revealed;
    if (this.modeIconEl) {
      setIcon(this.modeIconEl, st?.mode === "translation-only" ? "align-justify" : "columns-2");
    }
    if (this.modeLabelEl) {
      this.modeLabelEl.textContent = st?.mode === "translation-only" ? "仅译文" : "双语";
    }
    this.modeBtn.toggleClass("is-disabled", !modeUsable);
  }
}
