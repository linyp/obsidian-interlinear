import { App, Component, Notice, PluginSettingTab, Setting } from "obsidian";
import type { TextComponent } from "obsidian";
import type InterlinearPlugin from "../main";
import {
  getActiveLlmSettings,
  getActivePresetSettings,
  isConfigured,
  isInsecureBaseUrl,
  isLlmPresetId,
  isMtPresetId,
  normalizeLlmEndpointFieldOnBlur,
  PROVIDER_PRESETS,
  MT_SERVICE_PRESETS,
  selectPreset,
  TRANSLATION_STYLES,
  updateActivePreset,
} from "../settings";
import type {
  ActivePresetPatch,
  DisplayMode,
  FabVisibility,
  LlmEndpointField,
  LlmPresetId,
  TranslationStyle,
} from "../settings";
import { createProvider } from "../translator/factory";
import { AuthError, RateLimitError } from "../translator/provider";
import { obsidianRequestUrlClient } from "../translator/requestUrlClient";

type NumericSettingKey =
  | "concurrency"
  | "minIntervalMs"
  | "maxRetries"
  | "batchCharBudget"
  | "maxSegmentsPerBatch";

// Common target languages (friendly label + BCP-47 code). Users can still type
// any other code via the "Custom" option.
const LANGUAGE_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "zh-CN", label: "简体中文 (zh-CN)" },
  { value: "zh-TW", label: "繁體中文 (zh-TW)" },
  { value: "en", label: "English (en)" },
  { value: "ja", label: "日本語 (ja)" },
  { value: "ko", label: "한국어 (ko)" },
  { value: "vi", label: "Tiếng Việt (vi)" },
  { value: "fr", label: "Français (fr)" },
  { value: "de", label: "Deutsch (de)" },
  { value: "es", label: "Español (es)" },
  { value: "ru", label: "Русский (ru)" },
  { value: "pt-BR", label: "Português (pt-BR)" },
];
const CUSTOM_LANG = "__custom__";
const CUSTOM_PROVIDER = "custom";

function testFailureMessage(err: unknown): string {
  if (err instanceof AuthError) {
    return "Authentication failed — the endpoint rejected your API key (401/403).";
  }
  if (err instanceof RateLimitError) {
    return "Rate limited (429) — the key works, but the service is throttling requests.";
  }
  return "Connection failed: " + (err instanceof Error ? err.message : String(err));
}

export class InterlinearSettingTab extends PluginSettingTab {
  private readonly plugin: InterlinearPlugin;
  private controlEvents: Component | null = null;
  // True once the user picks "Custom" in the language dropdown (so the editable
  // field shows even while the stored value still happens to match a preset).
  private customLangMode = false;

  constructor(app: App, plugin: InterlinearPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.resetControlEvents();
    const { containerEl } = this;
    containerEl.empty();
    this.renderServiceSection(containerEl);
    this.renderDisplaySection(containerEl);
    this.renderAdvancedSection(containerEl);
  }

  hide(): void {
    this.disposeControlEvents();
    super.hide();
  }

  /** Re-render an open settings page after data.json is replaced externally. */
  refreshAfterExternalSettingsChange(): void {
    if (!this.containerEl.isConnected) return;
    this.customLangMode = false;
    this.display();
  }

  private resetControlEvents(): void {
    this.disposeControlEvents();
    this.controlEvents = this.plugin.addChild(new Component());
  }

  private disposeControlEvents(): void {
    if (!this.controlEvents) return;
    this.plugin.removeChild(this.controlEvents);
    this.controlEvents = null;
  }

  /** Route every preset-owned UI edit through the same pure update boundary. */
  private async saveActivePresetPatch(patch: ActivePresetPatch): Promise<void> {
    this.plugin.settings = updateActivePreset(this.plugin.settings, patch);
    await this.plugin.saveSettings();
  }

  // --- Translation service ---------------------------------------------------

  private renderServiceSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Translation service").setHeading();

    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName("Service")
      .setDesc(
        "Each preset keeps its own credentials and Advanced settings. The first selection creates a record with that preset's defaults; later selections restore the same record. Any /chat/completions endpoint works via Custom."
      )
      .addDropdown((dropdown) => {
        for (const p of PROVIDER_PRESETS) dropdown.addOption(p.id, p.label);
        dropdown.addOption(CUSTOM_PROVIDER, "Custom (OpenAI-compatible)…");
        for (const p of MT_SERVICE_PRESETS) dropdown.addOption(p.id, p.label);
        dropdown.setValue(settings.service);
        dropdown.onChange(async (value) => {
          if (!isLlmPresetId(value) && !isMtPresetId(value)) return;
          this.plugin.settings = selectPreset(this.plugin.settings, value);
          await this.plugin.saveSettings();
          this.display(); // re-render so the per-service fields reflect the selection
        });
      });

    switch (settings.service) {
      case "baidu":
        new Setting(containerEl)
          .setName("App ID")
          .setDesc("From the service's developer console (通用翻译 API). With personal verification (个人认证) the Advanced plan is free — 10 requests/second, 1M characters/month; matching request pacing was applied automatically. Unverified accounts allow only ~1 request/second — raise Min interval to ~1100 ms below.")
          .addText((text) =>
            text.setValue(settings.presets.mt.baidu!.appId).onChange(async (value) => {
              await this.saveActivePresetPatch({ appId: value.trim() });
            })
          );
        this.addSecretSetting(
          containerEl,
          "App secret (密钥)",
          "BYOK — stored only in local plugin settings files; never uploaded, logged, or committed.",
          () => settings.presets.mt.baidu!.appSecret,
          (v) => ({ appSecret: v })
        );
        break;
      case "youdao":
        new Setting(containerEl)
          .setName("App key (应用ID)")
          .setDesc("From the service's AI console (文本翻译). The console assigns each app a QPS quota (low on default apps) — conservative ~1 request/second pacing was applied automatically. Lower Min interval below only if your app's quota allows it; 411/412 errors mean it doesn't.")
          .addText((text) =>
            text.setValue(settings.presets.mt.youdao!.appKey).onChange(async (value) => {
              await this.saveActivePresetPatch({ appKey: value.trim() });
            })
          );
        this.addSecretSetting(
          containerEl,
          "App secret (应用密钥)",
          "BYOK — stored only in local plugin settings files; never uploaded, logged, or committed.",
          () => settings.presets.mt.youdao!.appSecret,
          (v) => ({ appSecret: v })
        );
        break;
      default:
        this.renderLlmFields(containerEl);
    }

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Sends one tiny translation request with the settings above to verify the credentials and endpoint.")
      .addButton((btn) => {
        btn.setButtonText("Test").onClick(async () => {
          if (!isConfigured(this.plugin.settings)) {
            new Notice("Fill in the service credentials first (for local servers any non-empty key works).");
            return;
          }
          btn.setDisabled(true);
          btn.setButtonText("Testing…");
          try {
            const provider = createProvider(this.plugin.settings, obsidianRequestUrlClient);
            const [sample] = await provider.translate(["Hello!"]);
            new Notice(`Connection OK — sample translation: ${sample.slice(0, 60)}`);
          } catch (err) {
            new Notice(testFailureMessage(err), 8000);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText("Test");
          }
        });
      });
  }

  /** The LLM-only rows (key/endpoint/model) — hidden while an MT service is active. */
  private renderLlmFields(containerEl: HTMLElement): void {
    const presetId = this.plugin.settings.service;
    if (!isLlmPresetId(presetId)) return;
    const active = getActiveLlmSettings(this.plugin.settings);
    if (!active) return;

    this.addSecretSetting(
      containerEl,
      "API key",
      "BYOK — stored only in local plugin settings files; never uploaded, logged, or committed.",
      () => active.apiKey,
      (v) => ({ apiKey: v }),
      "sk-..."
    );

    // Assigned right below; a `let` so the text-field onChange can call it
    // without re-rendering the whole tab (which would steal input focus).
    let refreshInsecureWarning = (): void => {};

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("Base address of the OpenAI-compatible endpoint.")
      .addText((text) => {
        text
          .setPlaceholder("https://api.deepseek.com")
          .setValue(active.baseUrl)
          .onChange(async (value) => {
            await this.saveActivePresetPatch({ baseUrl: value.trim() });
            refreshInsecureWarning();
          });
        this.restoreLlmEndpointOnBlur(text, presetId, "baseUrl", refreshInsecureWarning);
      });

    // SECURITY: plain http to a remote host would send the Bearer API key
    // unencrypted. Local http (Ollama etc.) is fine and stays silent.
    const insecureWarningEl = containerEl.createDiv({ cls: "it-insecure-warning" });
    refreshInsecureWarning = () => {
      const currentBaseUrl = getActiveLlmSettings(this.plugin.settings)?.baseUrl ?? "";
      insecureWarningEl.setText(
        isInsecureBaseUrl(currentBaseUrl)
          ? "⚠ This endpoint uses plain http:// to a remote host — your API key would be sent unencrypted. Use https:// (http is fine only for local servers like Ollama)."
          : ""
      );
    };
    refreshInsecureWarning();

    new Setting(containerEl).setName("Model").addText((text) => {
      text.setValue(active.model).onChange(async (value) => {
        await this.saveActivePresetPatch({ model: value.trim() });
      });
      this.restoreLlmEndpointOnBlur(text, presetId, "model");
    });
  }

  private restoreLlmEndpointOnBlur(
    text: TextComponent,
    presetId: LlmPresetId,
    field: LlmEndpointField,
    afterRestore?: () => void
  ): void {
    this.controlEvents?.registerDomEvent(text.inputEl, "blur", async () => {
      if (this.plugin.settings.service !== presetId) return;
      const active = getActiveLlmSettings(this.plugin.settings);
      if (!active) return;

      const restored = normalizeLlmEndpointFieldOnBlur(presetId, field, text.getValue());
      if (text.getValue() !== restored) text.setValue(restored);
      if (active[field] === restored) return;

      await this.saveActivePresetPatch({ [field]: restored } as ActivePresetPatch);
      afterRestore?.();
    });
  }

  /** A password-masked text row for credentials (all secrets share this shape). */
  private addSecretSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    getValue: () => string,
    patchValue: (value: string) => ActivePresetPatch,
    placeholder?: string
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        if (placeholder) text.setPlaceholder(placeholder);
        text.setValue(getValue()).onChange(async (value) => {
          await this.saveActivePresetPatch(patchValue(value.trim()));
        });
        text.inputEl.type = "password";
      });
  }

  // --- Display ---------------------------------------------------------------

  private renderDisplaySection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Display").setHeading();

    const currentLang = this.plugin.settings.targetLang;
    const isPreset = LANGUAGE_PRESETS.some((p) => p.value === currentLang);
    const showCustom = this.customLangMode || !isPreset;

    new Setting(containerEl)
      .setName("Target language")
      .setDesc("Language to translate into.")
      .addDropdown((dropdown) => {
        for (const p of LANGUAGE_PRESETS) dropdown.addOption(p.value, p.label);
        dropdown.addOption(CUSTOM_LANG, "Custom…");
        dropdown.setValue(showCustom ? CUSTOM_LANG : currentLang);
        dropdown.onChange(async (value) => {
          if (value === CUSTOM_LANG) {
            this.customLangMode = true;
          } else {
            this.customLangMode = false;
            this.plugin.settings.targetLang = value;
            await this.plugin.saveSettings();
          }
          this.display(); // re-render to show/hide the custom field
        });
      });

    if (showCustom) {
      new Setting(containerEl)
        .setName("Custom language code")
        .setDesc("Any BCP-47 code, e.g. th, it, pt-PT.")
        .addText((text) =>
          text
            .setPlaceholder("e.g. th")
            .setValue(isPreset ? "" : currentLang)
            .onChange(async (value) => {
              this.plugin.settings.targetLang = value.trim() || "zh-CN";
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Default display mode")
      .setDesc("How translations are shown after the first translate.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("bilingual", "Bilingual")
          .addOption("translation-only", "Translation only")
          .setValue(this.plugin.settings.defaultDisplayMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultDisplayMode = value as DisplayMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Translation style")
      .setDesc(
        "Visual theme for translated text. \"Learning mask\" blurs translations until you hover — handy for language practice. In translation-only mode, hovering a translation always reveals its original."
      )
      .addDropdown((dropdown) => {
        for (const s of TRANSLATION_STYLES) dropdown.addOption(s.value, s.label);
        dropdown.setValue(this.plugin.settings.translationStyle).onChange(async (value) => {
          this.plugin.settings.translationStyle = value as TranslationStyle;
          await this.plugin.saveSettings();
          this.plugin.refreshUi(); // restyle already-injected translations (CSS only)
        });
      });

    new Setting(containerEl)
      .setName("Floating button")
      .setDesc(
        "Shows a translate button in the lower-right of the reading view. On mobile this is the main entry point (there is no status bar)."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("always", "Always")
          .addOption("mobile", "Mobile only")
          .addOption("never", "Never")
          .setValue(this.plugin.settings.showFab)
          .onChange(async (value) => {
            this.plugin.settings.showFab = value as FabVisibility;
            await this.plugin.saveSettings();
            this.plugin.refreshUi();
          })
      );
  }

  // --- Advanced ----------------------------------------------------------------

  private renderAdvancedSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Advanced").setHeading();

    this.addNumberSetting(containerEl, "Concurrency", "Max concurrent requests.", "concurrency", 1, 16);
    this.addNumberSetting(containerEl, "Min interval (ms)", "Minimum spacing between request starts (ms).", "minIntervalMs", 0, 60000);
    this.addNumberSetting(containerEl, "Max retries", "Retries after the first attempt (429 / transient errors).", "maxRetries", 0, 10);
    this.addNumberSetting(containerEl, "Batch char budget", "Characters packed into each request.", "batchCharBudget", 200, 100000);
    this.addNumberSetting(containerEl, "Max segments per request", "Max blocks packed into one request (also bounded by the char budget). Smaller is more reliable.", "maxSegmentsPerBatch", 1, 100);

    // Custom instructions feed the LLM system prompt only — traditional MT
    // services have no prompt to append them to.
    if (isLlmPresetId(this.plugin.settings.service)) {
      const active = getActiveLlmSettings(this.plugin.settings)!;
      new Setting(containerEl)
        .setName("Custom instructions")
        .setDesc(
          "Optional. Appended to the translation system prompt — use it for a glossary, tone, or domain (e.g. \"Translate 'token' as 词元; keep a formal tone\"). Leave empty for the default."
        )
        .addTextArea((text) => {
          text
            .setPlaceholder("e.g. Use Taiwanese Mandarin terms; keep a formal register.")
            .setValue(active.customInstructions)
            .onChange(async (value) => {
              await this.saveActivePresetPatch({ customInstructions: value });
            });
          text.inputEl.rows = 4;
        });
    }

    new Setting(containerEl)
      .setName("Persistent cache")
      .setDesc(
        "Keep translations across restarts in the plugin folder (cache.json) so reopening a note costs nothing. Only translations and content hashes are stored — never your source text or API key."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.persistCache).onChange(async (value) => {
          this.plugin.settings.persistCache = value;
          await this.plugin.saveSettings();
          await this.plugin.onPersistCacheChanged(); // flush now / remove the file
          this.display();
        })
      );

    const approxKb = Math.round((this.plugin.cache.charSize * 2) / 1024);
    new Setting(containerEl)
      .setName("Cached translations")
      .setDesc(`${this.plugin.cache.size} entries (~${approxKb} KB).`)
      .addButton((btn) =>
        btn.setButtonText("Clear cache").onClick(async () => {
          await this.plugin.clearCacheCompletely();
          new Notice("Translation cache cleared.");
          this.display();
        })
      );
  }

  private addNumberSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    key: NumericSettingKey,
    min: number,
    max: number
  ): void {
    const active = getActivePresetSettings(this.plugin.settings);
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.setValue(String(active[key]));
        text.inputEl.type = "number";
        text.onChange(async (value) => {
          const n = Number(value);
          if (!Number.isFinite(n)) return;
          await this.saveActivePresetPatch({
            [key]: Math.min(max, Math.max(min, Math.round(n))),
          } as ActivePresetPatch);
        });
      });
  }
}
