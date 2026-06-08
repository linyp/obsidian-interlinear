/**
 * Floating action button + translation flow — the ONLY translation trigger.
 *
 * Shell file (imports obsidian/DOM); never imported by tests. All real logic
 * (segmentation, batching, rate limiting, provider, cache, skip rules) is the
 * pure, tested core — this just orchestrates it against the live reading view.
 *
 * Hard constraints honored here: translation runs ONLY on FAB/command click
 * (never on note open / leaf change), never writes to the markdown file, and
 * goes through requestUrl (via the injected HttpClient), never fetch.
 */
import { MarkdownView, Notice, setIcon } from "obsidian";
import type { App, Component } from "obsidian";
import {
  applyDisplayMode,
  clearTranslations,
  collectTranslatableBlocks,
  injectTranslation,
  InjectContext,
} from "../render/postProcessor";
import { chunkByBudget, Segment } from "../core/segmentation";
import { runPool } from "../core/rateLimiter";
import { DeepSeekProvider } from "../translator/deepseek";
import { HttpClient, AuthError } from "../translator/provider";
import { TranslationCache } from "../translator/cache";
import {
  DisplayMode,
  InterlinearSettings,
  isConfigured,
  toProviderConfig,
} from "../settings";
import { TranslateState, nextFabAction } from "./fabState";

const FAB_CLASS = "it-fab";
const FAB_ICON = "languages";
const FAB_BUSY_ICON = "loader";

interface FileState {
  state: TranslateState;
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

  constructor(deps: FabControllerDeps) {
    this.app = deps.app;
    this.component = deps.component;
    this.http = deps.http;
    this.getSettings = deps.getSettings;
    this.cache = deps.cache;
  }

  /** Ensure the active reading view has a FAB reflecting its state.
   *  Called on layout/leaf change — attaching the button is NOT a translation. */
  syncActiveView(): void {
    const active = this.getActiveReading();
    if (active) this.ensureFab(active.view);
  }

  async translateActiveView(): Promise<void> {
    const active = this.getActiveReading();
    if (!active) {
      new Notice("请在阅读模式下使用 Interlinear");
      return;
    }
    const st = this.stateFor(active.path);
    if (st.state === "translating") {
      new Notice("正在翻译，请稍候…");
      return;
    }
    await this.translate(active, st);
  }

  toggleModeActiveView(): void {
    const active = this.getActiveReading();
    if (!active) return;
    this.toggleMode(active, this.stateFor(active.path));
  }

  clearActiveView(): void {
    const active = this.getActiveReading();
    if (!active) return;
    clearTranslations(active.container);
    this.stateFor(active.path).state = "untranslated";
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
      st = { state: "untranslated", mode: this.getSettings().defaultDisplayMode };
      this.fileStates.set(path, st);
    }
    return st;
  }

  private ensureFab(view: MarkdownView): void {
    const host = view.contentEl;
    let fab = host.querySelector<HTMLButtonElement>(`.${FAB_CLASS}`);
    if (!fab) {
      fab = host.createEl("button", {
        cls: FAB_CLASS,
        attr: { type: "button", "aria-label": "Interlinear: 翻译 / 切换显示" },
      });
      this.component.registerDomEvent(fab, "click", () => void this.onFabClick());
    }
    this.paintFab(view, fab);
  }

  private refreshFab(view: MarkdownView): void {
    const fab = view.contentEl.querySelector<HTMLButtonElement>(`.${FAB_CLASS}`);
    if (fab) this.paintFab(view, fab);
  }

  private paintFab(view: MarkdownView, fab: HTMLElement): void {
    const path = view.file?.path;
    const state = path ? this.stateFor(path).state : "untranslated";
    fab.removeClass("is-translating", "is-translated");
    if (state === "translating") {
      fab.addClass("is-translating");
      setIcon(fab, FAB_BUSY_ICON);
    } else {
      if (state === "translated") fab.addClass("is-translated");
      setIcon(fab, FAB_ICON);
    }
  }

  private async onFabClick(): Promise<void> {
    const active = this.getActiveReading();
    if (!active) return;
    const st = this.stateFor(active.path);
    switch (nextFabAction(st.state)) {
      case "translate":
        await this.translate(active, st);
        break;
      case "toggle-mode":
        this.toggleMode(active, st);
        break;
      case "busy":
        new Notice("正在翻译，请稍候…");
        break;
    }
  }

  private toggleMode(active: ActiveReading, st: FileState): void {
    st.mode = st.mode === "bilingual" ? "translation-only" : "bilingual";
    applyDisplayMode(active.container, st.mode);
    new Notice(st.mode === "bilingual" ? "双语对照" : "仅译文");
  }

  /** The translate flow. Idempotent: cache hits skip the network, misses are
   *  (re)translated — so it doubles as the retry path for failed batches. */
  private async translate(active: ActiveReading, st: FileState): Promise<void> {
    const settings = this.getSettings();
    if (!isConfigured(settings)) {
      new Notice("请先在设置中填写 DeepSeek API key");
      return;
    }

    const collected = collectTranslatableBlocks(active.container);
    if (collected.length === 0) {
      new Notice("当前阅读视图没有可翻译的段落");
      return;
    }

    const { model, targetLang } = settings;
    const ctx: InjectContext = {
      app: this.app,
      sourcePath: active.path,
      component: this.component,
    };

    st.state = "translating";
    this.refreshFab(active.view);

    let injected = 0;
    let failedBatches = 0;
    let authFailed = false;

    try {
      // 1) Cache hits render immediately; misses are queued for translation.
      const misses: Array<{ collectedIdx: number; text: string }> = [];
      for (let i = 0; i < collected.length; i++) {
        const text = collected[i].descriptor.text;
        const cached = this.cache.get(text, model, targetLang);
        if (cached !== undefined) {
          await injectTranslation(collected[i].el, cached, ctx);
          injected++;
        } else {
          misses.push({ collectedIdx: i, text });
        }
      }

      // 2) Batch the misses by char budget and translate with bounded concurrency.
      if (misses.length > 0) {
        const segments: Segment[] = misses.map((m, k) => ({ index: k, text: m.text }));
        const chunks = chunkByBudget(segments, settings.batchCharBudget);
        const provider = new DeepSeekProvider({
          config: toProviderConfig(settings),
          http: this.http,
        });

        const tasks = chunks.map((chunk) => async () => {
          const translations = await provider.translate(chunk.map((s) => s.text));
          return chunk.map((s, j) => ({ missIdx: s.index, text: translations[j] }));
        });

        const results = await runPool(tasks, {
          concurrency: settings.concurrency,
          minIntervalMs: settings.minIntervalMs,
          maxRetries: settings.maxRetries,
        });

        for (const result of results) {
          if (!result.ok) {
            failedBatches++;
            if (result.error instanceof AuthError) authFailed = true;
            continue;
          }
          for (const { missIdx, text } of result.value) {
            const miss = misses[missIdx];
            this.cache.set(miss.text, model, targetLang, text);
            await injectTranslation(collected[miss.collectedIdx].el, text, ctx);
            injected++;
          }
        }
      }

      applyDisplayMode(active.container, st.mode);
      st.state = injected > 0 ? "translated" : "untranslated";

      if (authFailed) {
        new Notice("DeepSeek 鉴权失败，请检查 API key");
      } else if (failedBatches > 0) {
        new Notice(`有 ${failedBatches} 批内容翻译失败，可再次触发以重试`);
      }
    } catch (err) {
      st.state = injected > 0 ? "translated" : "untranslated";
      new Notice("翻译失败：" + errorMessage(err));
    } finally {
      this.refreshFab(active.view);
    }
  }
}
