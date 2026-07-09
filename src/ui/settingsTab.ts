import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type InterlinearPlugin from "../main";
import {
  applyProviderPreset,
  matchPreset,
  isConfigured,
  PROVIDER_PRESETS,
  TRANSLATION_STYLES,
} from "../settings";
import type { DisplayMode, FabVisibility, TranslationStyle } from "../settings";
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
  { value: "fr", label: "Français (fr)" },
  { value: "de", label: "Deutsch (de)" },
  { value: "es", label: "Español (es)" },
  { value: "ru", label: "Русский (ru)" },
  { value: "pt-BR", label: "Português (pt-BR)" },
];
const CUSTOM_LANG = "__custom__";
const CUSTOM_PROVIDER = "__custom__";

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
  // True once the user picks "Custom" in a dropdown (so the editable fields show
  // even while the stored value still happens to match a preset).
  private customLangMode = false;
  private customProviderMode = false;

  constructor(app: App, plugin: InterlinearPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.renderServiceSection(containerEl);
    this.renderDisplaySection(containerEl);
    this.renderAdvancedSection(containerEl);
  }

  // --- Translation service ---------------------------------------------------

  private renderServiceSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Translation service").setHeading();

    const settings = this.plugin.settings;
    const matched = matchPreset(settings);
    const showCustomProvider = this.customProviderMode || matched === null;
    const isBaidu = settings.providerKind === "baidu";

    new Setting(containerEl)
      .setName("Service preset")
      .setDesc(
        "Pre-fills the endpoint, model, and recommended rate/batch tuning for common services (overwrites the Advanced values below). Custom leaves Advanced untouched and speaks the OpenAI-compatible /chat/completions protocol."
      )
      .addDropdown((dropdown) => {
        for (const p of PROVIDER_PRESETS) dropdown.addOption(p.id, p.label);
        dropdown.addOption(CUSTOM_PROVIDER, "Custom…");
        dropdown.setValue(showCustomProvider ? CUSTOM_PROVIDER : (matched?.id ?? CUSTOM_PROVIDER));
        dropdown.onChange(async (value) => {
          if (value === CUSTOM_PROVIDER) {
            this.customProviderMode = true;
            // Custom means "any OpenAI-compatible endpoint" — flip kind back to
            // openai in case we're coming from the Baidu preset (whose baseUrl
            // holds an APP ID, not a URL). Then let the user edit the fields.
            this.plugin.settings.providerKind = "openai";
            await this.plugin.saveSettings();
          } else {
            this.customProviderMode = false;
            const preset = PROVIDER_PRESETS.find((p) => p.id === value);
            if (preset) {
              // Pre-fill endpoint/model AND the service's recommended Advanced
              // tuning (overwrites current values — each service rate-limits
              // differently). Custom leaves Advanced untouched.
              this.plugin.settings = applyProviderPreset(this.plugin.settings, preset);
              await this.plugin.saveSettings();
            }
          }
          this.display(); // re-render so the URL/model + Advanced fields reflect the preset
        });
      });

    new Setting(containerEl)
      .setName("API key")
      .setDesc(
        isBaidu
          ? "Baidu API secret (密钥). BYOK — stored only in the local data.json; never uploaded, logged, or committed."
          : "BYOK — stored only in the local data.json; never uploaded, logged, or committed."
      )
      .addText((text) => {
        text
          .setPlaceholder(isBaidu ? "Baidu secret key" : "sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc(
        isBaidu
          ? "Baidu APP ID (appid). This field is repurposed for Baidu — the wire endpoint is fixed by the service."
          : "Base address of the OpenAI-compatible endpoint."
      )
      .addText((text) =>
        text
          .setPlaceholder(isBaidu ? "e.g. 2015063000000001" : "https://api.deepseek.com")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            const trimmed = value.trim();
            // For Baidu, an empty baseUrl means "no APP ID yet" (isConfigured
            // will gate translation). For OpenAI-compatible it falls back to
            // the DeepSeek default so a blank field never breaks translation.
            this.plugin.settings.baseUrl = isBaidu
              ? trimmed
              : trimmed || "https://api.deepseek.com";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc(
        isBaidu
          ? "Not used by Baidu (the API has no model field). Anything typed here is ignored."
          : ""
      )
      .addText((text) => {
        text.setValue(this.plugin.settings.model).onChange(async (value) => {
          const trimmed = value.trim();
          this.plugin.settings.model = isBaidu ? trimmed : trimmed || "deepseek-v4-flash";
          await this.plugin.saveSettings();
        });
        text.inputEl.disabled = isBaidu;
      });

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Sends one tiny translation request with the settings above to verify the key and endpoint.")
      .addButton((btn) => {
        btn.setButtonText("Test").onClick(async () => {
          if (!isConfigured(this.plugin.settings)) {
            new Notice(
              this.plugin.settings.providerKind === "baidu"
                ? "Set an APP ID (Base URL) and secret (API key) first."
                : "Set an API key first (for local servers any non-empty value works)."
            );
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

    new Setting(containerEl)
      .setName("Custom instructions")
      .setDesc(
        "Optional. Appended to the translation system prompt — use it for a glossary, tone, or domain (e.g. \"Translate 'token' as 词元; keep a formal tone\"). Leave empty for the default."
      )
      .addTextArea((text) => {
        text
          .setPlaceholder("e.g. Use Taiwanese Mandarin terms; keep a formal register.")
          .setValue(this.plugin.settings.customInstructions)
          .onChange(async (value) => {
            this.plugin.settings.customInstructions = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
      });

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
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.setValue(String(this.plugin.settings[key]));
        text.inputEl.type = "number";
        text.onChange(async (value) => {
          const n = Number(value);
          if (!Number.isFinite(n)) return;
          this.plugin.settings[key] = Math.min(max, Math.max(min, Math.round(n)));
          await this.plugin.saveSettings();
        });
      });
  }
}
