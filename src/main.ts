import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, InterlinearSettings, normalizeSettings } from "./settings";
import { TranslationCache } from "./translator/cache";
import { obsidianRequestUrlClient } from "./translator/requestUrlClient";
import { TranslationController } from "./ui/translateButton";
import { InterlinearSettingTab } from "./ui/settingsTab";

/**
 * Interlinear — reading-mode immersive translation for Obsidian.
 *
 * Composition root. Hard constraints enforced here:
 *  - The markdown post-processor NEVER translates / hits the network.
 *  - Translation runs ONLY via the FAB or a command (never on note open).
 *  - Settings persist to data.json (plugin data, gitignored) — never the note body.
 */
export default class InterlinearPlugin extends Plugin {
  settings: InterlinearSettings = DEFAULT_SETTINGS;
  private readonly cache = new TranslationCache();
  private controller!: TranslationController;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.controller = new TranslationController({
      app: this.app,
      component: this,
      http: obsidianRequestUrlClient,
      getSettings: () => this.settings,
      cache: this.cache,
    });
    this.controller.mountStatusBar(this.addStatusBarItem());

    this.addSettingTab(new InterlinearSettingTab(this.app, this));

    // Reading-mode render hook kept as the documented render-only boundary: it
    // NEVER translates here. On-screen injection of (cached) translations is
    // driven by a MutationObserver in the controller, because the reading view's
    // post-processor does not fire reliably when sections render on scroll.
    this.registerMarkdownPostProcessor(() => {
      /* no-op: translation is started only by the FAB / commands */
    });

    // Refresh the status-bar buttons when the active note/layout changes. This is
    // NOT a translation trigger — translation only starts on an explicit click/command.
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.controller.syncActiveView()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.controller.syncActiveView()));
    this.app.workspace.onLayoutReady(() => this.controller.syncActiveView());

    this.addCommand({
      id: "toggle-translation",
      name: "Translate / show original",
      // Default ⌥A (Alt = Option on macOS); rebindable in Settings → Hotkeys.
      hotkeys: [{ modifiers: ["Alt"], key: "a" }],
      callback: () => this.controller.toggleTranslate(),
    });
    this.addCommand({
      id: "toggle-display-mode",
      name: "Toggle display mode (bilingual / translation-only)",
      callback: () => this.controller.toggleMode(),
    });
    this.addCommand({
      id: "clear-translations",
      name: "Clear translations",
      callback: () => this.controller.clearActiveView(),
    });
  }

  onunload(): void {
    // register*/add* registrations are torn down automatically by Obsidian.
    this.cache.clear();
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
