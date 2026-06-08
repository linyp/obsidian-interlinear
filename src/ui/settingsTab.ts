import { App, PluginSettingTab, Setting } from "obsidian";
import type InterlinearPlugin from "../main";
import type { DisplayMode } from "../settings";

type NumericSettingKey = "concurrency" | "minIntervalMs" | "maxRetries" | "batchCharBudget";

export class InterlinearSettingTab extends PluginSettingTab {
  private readonly plugin: InterlinearPlugin;

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

    new Setting(containerEl)
      .setName("Target language")
      .setDesc("译文目标语言（如 zh-CN、en）")
      .addText((text) =>
        text.setValue(this.plugin.settings.targetLang).onChange(async (value) => {
          this.plugin.settings.targetLang = value.trim() || "zh-CN";
          await this.plugin.saveSettings();
        })
      );

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
