import { describe, it, expect, vi } from "vitest";
import { createProvider } from "../translator/factory";
import { normalizeSettings, selectPreset } from "../settings";
import { DeepSeekProvider } from "../translator/deepseek";
import { BaiduProvider } from "../translator/baidu";
import { YoudaoProvider } from "../translator/youdao";

const http = vi.fn();

describe("createProvider", () => {
  it("maps each service id to its provider class", () => {
    const defaults = normalizeSettings(null);
    expect(createProvider(selectPreset(defaults, "baidu"), http)).toBeInstanceOf(BaiduProvider);
    expect(createProvider(selectPreset(defaults, "youdao"), http)).toBeInstanceOf(YoudaoProvider);
  });

  it("maps every LLM preset and absent/unknown values to the LLM provider", () => {
    for (const service of ["deepseek", "openai", "siliconflow", "ollama", "custom"] as const) {
      expect(createProvider(selectPreset(normalizeSettings(null), service), http)).toBeInstanceOf(DeepSeekProvider);
    }
    expect(createProvider(normalizeSettings({}), http)).toBeInstanceOf(DeepSeekProvider);
    expect(createProvider(normalizeSettings({ service: "bing" as never }), http)).toBeInstanceOf(
      DeepSeekProvider
    );
  });

  it("surfaces per-request caps through the interface (LLM has none)", () => {
    const llm = createProvider(normalizeSettings({}), http);
    expect(llm.maxSegmentsPerRequest).toBeUndefined();
    expect(llm.maxCharsPerRequest).toBeUndefined();
    const baidu = createProvider(selectPreset(normalizeSettings(null), "baidu"), http);
    expect(baidu.maxSegmentsPerRequest).toBe(1);
    const youdao = createProvider(selectPreset(normalizeSettings(null), "youdao"), http);
    expect(youdao.maxCharsPerRequest).toBe(4500);
  });
});
