import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, InterlinearSettings, normalizeSettings } from "./settings";
import { TranslationCache } from "./translator/cache";
import { obsidianRequestUrlClient } from "./translator/requestUrlClient";
import { FabController } from "./ui/translateButton";
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
  private controller!: FabController;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.controller = new FabController({
      app: this.app,
      component: this,
      http: obsidianRequestUrlClient,
      getSettings: () => this.settings,
      cache: this.cache,
    });

    this.addSettingTab(new InterlinearSettingTab(this.app, this));

    // Reading-mode render hook kept as the documented render-only boundary: it
    // NEVER translates here. On-screen injection of (cached) translations is
    // driven by a MutationObserver in the controller, because the reading view's
    // post-processor does not fire reliably when sections render on scroll.
    this.registerMarkdownPostProcessor(() => {
      /* no-op: translation is started only by the FAB / commands */
    });

    // Keep a FAB on the active reading view. Attaching the button is NOT a
    // translation trigger — it just waits for an explicit click.
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.controller.syncActiveView()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.controller.syncActiveView()));
    this.app.workspace.onLayoutReady(() => this.controller.syncActiveView());

    this.addCommand({
      id: "translate-current-note",
      name: "Translate current note",
      callback: () => void this.controller.translateActiveView(),
    });
    this.addCommand({
      id: "toggle-display-mode",
      name: "Toggle translation display mode",
      callback: () => this.controller.toggleModeActiveView(),
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
