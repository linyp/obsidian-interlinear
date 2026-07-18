import { Notice, Plugin, debounce } from "obsidian";
import {
  DEFAULT_SETTINGS,
  InterlinearSettings,
  SETTINGS_BACKUP_FILENAME,
  isLegacySettingsData,
  loadStoredSettings,
  providerConfigSignature,
  UnsupportedSettingsSchemaVersionError,
} from "./settings";
import { TranslationCache } from "./translator/cache";
import { obsidianRequestUrlClient } from "./translator/requestUrlClient";
import { TranslationController } from "./ui/translateButton";
import { InterlinearSettingTab } from "./ui/settingsTab";

const SETTINGS_MIGRATION_NOTICE_MS = 15_000;
const SETTINGS_MIGRATION_NOTICE =
  "Interlinear upgraded its settings format and kept a local backup as data.backup.json. If you sync plugin settings, update Interlinear on every device before changing settings; mixed versions and downgrades are not supported.";

/**
 * Interlinear — reading-mode interlinear translation for Obsidian.
 *
 * Composition root. Hard constraints enforced here:
 *  - The markdown post-processor NEVER translates / hits the network.
 *  - Translation runs ONLY via the FAB / status bar / a command (never on note open).
 *  - Settings persist to data.json (with data.backup.json retained after a schema
 *    migration), the translation cache to cache.json — all in the plugin folder;
 *    note bodies are never written.
 */
export default class InterlinearPlugin extends Plugin {
  settings: InterlinearSettings = DEFAULT_SETTINGS;
  readonly cache = new TranslationCache();
  private controller!: TranslationController;
  private settingTab: InterlinearSettingTab | null = null;
  /** Last seen provider-config signature; a change drops stale per-note failures. */
  private lastConfigSig = "";
  /** Prevent an older plugin instance from overwriting unsupported synced data. */
  private settingsWritesBlocked = false;

  /** Trailing-edge debounce so a burst of cache writes becomes one disk flush. */
  private readonly scheduleCacheFlush = debounce(() => void this.flushCache(), 3000, true);

  async onload(): Promise<void> {
    await this.loadSettings();
    this.lastConfigSig = providerConfigSignature(this.settings);
    await this.loadCacheFromDisk();
    this.cache.onDirty = () => this.scheduleCacheFlush();

    this.controller = new TranslationController({
      app: this.app,
      component: this,
      http: obsidianRequestUrlClient,
      getSettings: () => this.settings,
      cache: this.cache,
    });
    this.controller.mountStatusBar(this.addStatusBarItem());

    this.settingTab = new InterlinearSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // Reading-mode render hook kept as the documented render-only boundary: it
    // NEVER translates here. On-screen injection of (cached) translations is
    // driven by a MutationObserver in the controller, because the reading view's
    // post-processor does not fire reliably when sections render on scroll.
    this.registerMarkdownPostProcessor(() => {
      /* no-op: translation is started only by the FAB / commands */
    });

    // Refresh the FAB + status-bar buttons when the active note/layout changes.
    // NOT a translation trigger — translation only starts on an explicit click/command.
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.controller.syncActiveView()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.controller.syncActiveView()));
    this.app.workspace.onLayoutReady(() => this.controller.syncActiveView());

    // No default hotkey (community guideline): users bind their own under
    // Settings → Hotkeys → "Interlinear: Translate / show original".
    this.addCommand({
      id: "toggle-translation",
      name: "Translate / show original",
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
    this.scheduleCacheFlush.cancel();
    void this.flushCache(); // best-effort final flush of the persistent cache
  }

  async loadSettings(): Promise<void> {
    this.settingsWritesBlocked = true;
    let migratedLegacySettings = false;
    try {
      const stored = await this.loadData();
      migratedLegacySettings = isLegacySettingsData(stored);
      const backupPath = this.pluginFilePath(SETTINGS_BACKUP_FILENAME);
      this.settings = await loadStoredSettings(stored, {
        readBackup: async () =>
          (await this.app.vault.adapter.exists(backupPath))
            ? this.app.vault.adapter.read(backupPath)
            : null,
        writeBackup: (data) => this.app.vault.adapter.write(backupPath, data),
        writeSettings: (settings) => this.saveData(settings),
      });
      this.settingsWritesBlocked = false;
    } catch (error) {
      if (error instanceof UnsupportedSettingsSchemaVersionError) {
        console.error(`Interlinear: ${error.message}`);
      } else {
        console.error("Interlinear: failed to load settings");
      }
      throw error;
    }

    if (migratedLegacySettings) {
      new Notice(SETTINGS_MIGRATION_NOTICE, SETTINGS_MIGRATION_NOTICE_MS);
    }
  }

  async saveSettings(): Promise<void> {
    if (this.settingsWritesBlocked) {
      throw new Error(
        "Interlinear: settings writes are blocked until supported settings data loads successfully"
      );
    }
    await this.saveData(this.settings);
    this.reactToConfigChange();
  }

  /**
   * Obsidian calls this when data.json is changed externally (e.g. Obsidian
   * Sync pushing a different config from another device). Reload settings,
   * react to any provider-config change, and refresh the UI.
   */
  async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
    this.reactToConfigChange();
    this.refreshUi();
    this.settingTab?.refreshAfterExternalSettingsChange();
  }

  /** If the provider config changed, drop stale per-note failures so they can
   *  be retried under the new config (see TranslationController). */
  private reactToConfigChange(): void {
    const sig = providerConfigSignature(this.settings);
    if (sig === this.lastConfigSig) return;
    this.lastConfigSig = sig;
    this.controller.onProviderConfigChanged();
  }

  /** Re-sync FAB/status bar/styles after a settings change. */
  refreshUi(): void {
    this.controller.syncActiveView();
  }

  // --- persistent cache (plugin folder only — never the notes) --------------

  private pluginFilePath(filename: string): string {
    const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    return `${dir}/${filename}`;
  }

  private cacheFilePath(): string {
    return this.pluginFilePath("cache.json");
  }

  private async loadCacheFromDisk(): Promise<void> {
    if (!this.settings.persistCache) return;
    try {
      const path = this.cacheFilePath();
      if (!(await this.app.vault.adapter.exists(path))) return;
      this.cache.hydrate(await this.app.vault.adapter.read(path));
    } catch (err) {
      console.error("Interlinear: failed to load translation cache", err);
    }
  }

  private async flushCache(): Promise<void> {
    if (!this.settings.persistCache) return;
    try {
      await this.app.vault.adapter.write(this.cacheFilePath(), this.cache.serialize());
    } catch (err) {
      console.error("Interlinear: failed to save translation cache", err);
    }
  }

  /** Settings-tab action: wipe the cache in memory and on disk. */
  async clearCacheCompletely(): Promise<void> {
    this.scheduleCacheFlush.cancel();
    this.cache.clear();
    await this.removeCacheFile();
  }

  /** Settings-tab action: react to the persist-cache toggle. */
  async onPersistCacheChanged(): Promise<void> {
    if (this.settings.persistCache) {
      await this.flushCache();
    } else {
      this.scheduleCacheFlush.cancel();
      await this.removeCacheFile();
    }
  }

  private async removeCacheFile(): Promise<void> {
    try {
      const path = this.cacheFilePath();
      if (await this.app.vault.adapter.exists(path)) {
        await this.app.vault.adapter.remove(path);
      }
    } catch (err) {
      console.error("Interlinear: failed to remove translation cache file", err);
    }
  }
}
