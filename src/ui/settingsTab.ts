import { App, PluginSettingTab, Setting } from "obsidian";
import type InterlinearPlugin from "../main";
import type { DisplayMode } from "../settings";

type NumericSettingKey = "concurrency" | "minIntervalMs" | "maxRetries" | "batchCharBudget";

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

export class InterlinearSettingTab extends PluginSettingTab {
  private readonly plugin: InterlinearPlugin;
  // True once the user picks "Custom" in the dropdown (so the text field shows
  // even while the stored value still happens to match a preset).
  private customLangMode = false;

  constructor(app: App, plugin: InterlinearPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("DeepSeek API key")
      .setDesc("BYOK — 仅保存在本地 data.json，不上传、不记录、不提交仓库。")
      .addText((text) => {
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("OpenAI 兼容端点的基础地址")
      .addText((text) =>
        text
          .setPlaceholder("https://api.deepseek.com")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            this.plugin.settings.baseUrl = value.trim() || "https://api.deepseek.com";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Model").addText((text) =>
      text.setValue(this.plugin.settings.model).onChange(async (value) => {
        this.plugin.settings.model = value.trim() || "deepseek-v4-flash";
        await this.plugin.saveSettings();
      })
    );

    const currentLang = this.plugin.settings.targetLang;
    const isPreset = LANGUAGE_PRESETS.some((p) => p.value === currentLang);
    const showCustom = this.customLangMode || !isPreset;

    new Setting(containerEl)
      .setName("Target language")
      .setDesc("译文目标语言")
      .addDropdown((dropdown) => {
        for (const p of LANGUAGE_PRESETS) dropdown.addOption(p.value, p.label);
        dropdown.addOption(CUSTOM_LANG, "自定义… (Custom)");
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
        .setDesc("任意 BCP-47 代码，如 th、it、pt-PT")
        .addText((text) =>
          text
            .setPlaceholder("例如 th")
            .setValue(isPreset ? "" : currentLang)
            .onChange(async (value) => {
              this.plugin.settings.targetLang = value.trim() || "zh-CN";
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("Default display mode")
      .setDesc("首次翻译后的默认展示方式")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("bilingual", "双语对照")
          .addOption("translation-only", "仅译文")
          .setValue(this.plugin.settings.defaultDisplayMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultDisplayMode = value as DisplayMode;
            await this.plugin.saveSettings();
          })
      );

    this.addNumberSetting(containerEl, "Concurrency", "并发请求数", "concurrency", 1, 16);
    this.addNumberSetting(containerEl, "Min interval (ms)", "请求间隔（毫秒）", "minIntervalMs", 0, 60000);
    this.addNumberSetting(containerEl, "Max retries", "失败重试次数（429/瞬时错误）", "maxRetries", 0, 10);
    this.addNumberSetting(containerEl, "Batch char budget", "每批请求的字符预算", "batchCharBudget", 200, 100000);
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
