import { describe, it, expect, vi } from "vitest";
import { createProvider } from "../translator/factory";
import { normalizeSettings } from "../settings";
import { DeepSeekProvider } from "../translator/deepseek";
import { BaiduProvider } from "../translator/baidu";
import { YoudaoProvider } from "../translator/youdao";

const http = vi.fn();

describe("createProvider", () => {
  it("maps each service id to its provider class", () => {
    expect(createProvider(normalizeSettings({ service: "baidu" }), http)).toBeInstanceOf(BaiduProvider);
    expect(createProvider(normalizeSettings({ service: "youdao" }), http)).toBeInstanceOf(YoudaoProvider);
  });

  it("defaults to the LLM provider (llm service, and absent/unknown values)", () => {
    expect(createProvider(normalizeSettings({ service: "llm" }), http)).toBeInstanceOf(DeepSeekProvider);
    expect(createProvider(normalizeSettings({}), http)).toBeInstanceOf(DeepSeekProvider);
    expect(createProvider(normalizeSettings({ service: "bing" as never }), http)).toBeInstanceOf(
      DeepSeekProvider
    );
  });

  it("surfaces per-request caps through the interface (LLM has none)", () => {
    const llm = createProvider(normalizeSettings({}), http);
    expect(llm.maxSegmentsPerRequest).toBeUndefined();
    expect(llm.maxCharsPerRequest).toBeUndefined();
    const baidu = createProvider(normalizeSettings({ service: "baidu" }), http);
    expect(baidu.maxSegmentsPerRequest).toBe(1);
    const youdao = createProvider(normalizeSettings({ service: "youdao" }), http);
    expect(youdao.maxCharsPerRequest).toBe(4500);
  });
});
