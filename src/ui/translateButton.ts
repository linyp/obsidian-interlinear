/**
 * Floating action button + translation flow — the ONLY translation trigger.
 *
 * Shell file (imports obsidian/DOM); never imported by tests. All real logic
 * (segmentation, batching, rate limiting, provider, cache, skip rules) is the
 * pure, tested core — this just orchestrates it against the live reading view.
 *
 * Obsidian's reading view is VIRTUALIZED: off-screen blocks aren't in the live
 * DOM (unlike a web page). So one click:
 *   1. translates the on-screen blocks immediately;
 *   2. pre-translates the WHOLE note into the cache in the background (by
 *      rendering its source off-screen — a plain render isn't virtualized); and
 *   3. uses a MutationObserver to inject cached translations into each block the
 *      instant Obsidian renders it (e.g. on scroll). The reading-view markdown
 *      post-processor does NOT fire reliably on scroll, so the observer — not the
 *      post-processor — is what keeps the rest of the note translated.
 *
 * Translation is started ONLY by an explicit FAB click / command (the `active`
 * flag). Cache + idempotent injection make re-renders free.
 */
import { MarkdownView, Notice, setIcon } from "obsidian";
import type { App, Component } from "obsidian";
import {
  applyDisplayMode,
  clearTranslations,
  collectSourceBlockTexts,
  collectTranslatableBlocks,
  injectTranslation,
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
import { nextFabAction } from "./fabState";

const FAB_CLASS = "it-fab";
const FAB_ICON = "languages";
const FAB_BUSY_ICON = "loader";
// Coalesce the burst of DOM mutations Obsidian emits while rendering sections.
const SYNC_DEBOUNCE_MS = 120;

interface FileState {
  active: boolean;
  mode: DisplayMode;
}

interface ActiveReading {
  view: MarkdownView;
  container: HTMLElement;
  path: string;
}

export interface FabControllerDeps {
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

export class FabController {
  private readonly app: App;
  private readonly component: Component;
  private readonly http: HttpClient;
  private readonly getSettings: () => InterlinearSettings;
  private readonly cache: TranslationCache;

  private readonly fileStates = new Map<string, FileState>();
  private readonly flushing = new Set<string>();
  private readonly syncing = new Set<string>();
  // Texts whose translation failed; skipped on scroll so a failure can't loop.
  // Cleared when the user re-activates (re-click) so failures get one retry.
  private readonly failedTexts = new Map<string, Set<string>>();

  private observer: MutationObserver | null = null;
  private observedEl: HTMLElement | null = null;
  private syncTimer: number | null = null;

  constructor(deps: FabControllerDeps) {
    this.app = deps.app;
    this.component = deps.component;
    this.http = deps.http;
    this.getSettings = deps.getSettings;
    this.cache = deps.cache;
  }

  /** Ensure the active reading view has a FAB. Attaching it is NOT a translation. */
  syncActiveView(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() !== "preview") return;
    this.ensureFab(view);
    const path = view.file?.path;
    if (path && this.stateFor(path).active) {
      // Returning to an already-activated note: keep observing it and re-inject.
      this.observe(view.previewMode.containerEl);
      this.scheduleSync();
    }
  }

  translateActiveView(): void {
    const active = this.getActiveReading();
    if (!active) {
      new Notice("请在阅读模式下使用 Interlinear");
      return;
    }
    this.activate(active);
  }

  toggleModeActiveView(): void {
    const active = this.getActiveReading();
    if (active) this.toggleMode(active, this.stateFor(active.path));
  }

  clearActiveView(): void {
    const active = this.getActiveReading();
    if (!active) return;
    this.stateFor(active.path).active = false;
    this.failedTexts.delete(active.path);
    if (this.observedEl === active.container) {
      this.observer?.disconnect();
      this.observedEl = null;
    }
    clearTranslations(active.container);
    this.refreshFab(active.view);
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
      st = { active: false, mode: this.getSettings().defaultDisplayMode };
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
    this.failedTexts.delete(active.path); // re-click retries previously-failed blocks
    this.observe(active.container);
    this.refreshFab(active.view);
    if (firstActivation) new Notice("正在翻译整篇…");

    // Translate the visible blocks now (fast feedback) and pre-translate the rest.
    void this.syncVisible(active, st);
    void this.pretranslateWholeDoc(active);
  }

  /**
   * Re-inject cached translations whenever Obsidian renders new section DOM
   * (e.g. on scroll). This is the reliable "content rendered" hook — the reading
   * view's markdown post-processor does not fire dependably on scroll.
   */
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

  /**
   * Translate/inject the blocks currently on screen: cache hits inject instantly,
   * misses are translated once (and recorded on failure so they don't loop).
   * Serialized per note so overlapping observer ticks can't double-translate.
   */
  private async syncVisible(active: ActiveReading, st: FileState): Promise<void> {
    if (!st.active) return;
    if (this.syncing.has(active.path)) {
      this.scheduleSync(); // try again after the in-flight run finishes
      return;
    }
    const failed = this.failedTexts.get(active.path);
    const blocks = collectTranslatableBlocks(active.container).filter((b) => {
      const sib = b.el.nextElementSibling;
      if (sib && sib.hasClass(TRANSLATION_CLASS)) return false; // already injected
      if (failed && failed.has(b.descriptor.text)) return false; // don't retry in a loop
      return true;
    });
    if (blocks.length === 0) return;

    this.syncing.add(active.path);
    this.flushing.add(active.path);
    this.repaintActiveFab();
    try {
      await this.translateBatch(blocks, active.container, active.path, this.getSettings(), st);
    } catch (err) {
      new Notice("翻译失败：" + errorMessage(err));
    } finally {
      this.syncing.delete(active.path);
      this.flushing.delete(active.path);
      this.repaintActiveFab();
    }
  }

  /**
   * Pre-translate the ENTIRE note into the cache by rendering its source off-screen
   * (a plain MarkdownRenderer.render is not virtualized → the whole document). The
   * results can't be injected off-screen, but the observer injects them instantly
   * as each block scrolls into view.
   */
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
      return; // best-effort; visible + on-scroll translation still work
    }

    const { model, targetLang } = settings;
    const misses = texts.filter((t) => this.cache.get(t, model, targetLang) === undefined);
    if (misses.length === 0) {
      await this.syncVisible(active, this.stateFor(active.path));
      return;
    }

    this.flushing.add(active.path);
    this.repaintActiveFab();
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
      this.repaintActiveFab();
    }

    // Inject whatever is now on screen (and let the observer handle the rest).
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

    // Cache hits render immediately; misses are queued for translation.
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

    let authFailed = false;
    let failed = 0;
    if (misses.length > 0) {
      const segments: Segment[] = misses.map((m, k) => ({ index: k, text: m.text }));
      const chunks = chunkByBudget(segments, settings.batchCharBudget);
      const provider = new DeepSeekProvider({ config: toProviderConfig(settings), http: this.http });

      const tasks = chunks.map((chunk) => async () => {
        const translations = await provider.translate(chunk.map((s) => s.text));
        return chunk.map((s, j) => ({ missIdx: s.index, text: translations[j] }));
      });

      const results = await runPool(tasks, {
        concurrency: settings.concurrency,
        minIntervalMs: settings.minIntervalMs,
        maxRetries: settings.maxRetries,
      });

      const failedSet = this.failedTextsFor(path);
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (!result.ok) {
          failed++;
          if (result.error instanceof AuthError) authFailed = true;
          for (const s of chunks[i]) failedSet.add(s.text); // don't retry these in a loop
          continue;
        }
        for (const { missIdx, text } of result.value) {
          const miss = misses[missIdx];
          this.cache.set(miss.text, model, targetLang, text);
          await injectTranslation(miss.el, text, ctx);
        }
      }
    }

    if (container) applyDisplayMode(container, st.mode);

    if (authFailed) new Notice("DeepSeek 鉴权失败，请检查 API key");
    else if (failed > 0) new Notice(`有 ${failed} 批内容翻译失败，可重新触发以重试`);
  }

  private toggleMode(active: ActiveReading, st: FileState): void {
    st.mode = st.mode === "bilingual" ? "translation-only" : "bilingual";
    applyDisplayMode(active.container, st.mode);
    new Notice(st.mode === "bilingual" ? "双语对照" : "仅译文");
  }

  private onFabClick(): void {
    const active = this.getActiveReading();
    if (!active) return;
    if (nextFabAction(this.stateFor(active.path).active) === "toggle-mode") {
      this.toggleMode(active, this.stateFor(active.path));
    } else {
      this.activate(active);
    }
  }

  private ensureFab(view: MarkdownView): void {
    const host = view.contentEl;
    let fab = host.querySelector<HTMLButtonElement>(`.${FAB_CLASS}`);
    if (!fab) {
      fab = host.createEl("button", {
        cls: FAB_CLASS,
        attr: { type: "button", "aria-label": "Interlinear: 翻译 / 切换显示" },
      });
      this.component.registerDomEvent(fab, "click", () => this.onFabClick());
    }
    this.paintFab(view, fab);
  }

  private refreshFab(view: MarkdownView): void {
    const fab = view.contentEl.querySelector<HTMLButtonElement>(`.${FAB_CLASS}`);
    if (fab) this.paintFab(view, fab);
  }

  private repaintActiveFab(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.getMode() === "preview") this.refreshFab(view);
  }

  private paintFab(view: MarkdownView, fab: HTMLElement): void {
    const path = view.file?.path;
    const active = path ? this.stateFor(path).active : false;
    const busy = path ? this.flushing.has(path) : false;
    fab.removeClass("is-translating", "is-translated");
    if (busy) {
      fab.addClass("is-translating");
      setIcon(fab, FAB_BUSY_ICON);
    } else {
      if (active) fab.addClass("is-translated");
      setIcon(fab, FAB_ICON);
    }
  }
}
