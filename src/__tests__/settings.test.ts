import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  toProviderConfig,
  isConfigured,
  matchPreset,
  PROVIDER_PRESETS,
} from "../settings";

describe("normalizeSettings", () => {
  it("returns defaults for null/undefined/non-object input", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial stored data over defaults", () => {
    const s = normalizeSettings({ apiKey: "sk-x", targetLang: "en" });
    expect(s.apiKey).toBe("sk-x");
    expect(s.targetLang).toBe("en");
    expect(s.model).toBe(DEFAULT_SETTINGS.model);
  });

  it("falls back empty/whitespace strings to defaults", () => {
    const s = normalizeSettings({ baseUrl: "   ", model: "", targetLang: "" });
    expect(s.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);
    expect(s.model).toBe(DEFAULT_SETTINGS.model);
    expect(s.targetLang).toBe(DEFAULT_SETTINGS.targetLang);
  });

  it("clamps numeric fields into range and rounds", () => {
    const s = normalizeSettings({
      concurrency: 0,
      minIntervalMs: -5,
      maxRetries: 99,
      batchCharBudget: 1.7,
      maxSegmentsPerBatch: 999,
    });
    expect(s.concurrency).toBe(1); // min 1
    expect(s.minIntervalMs).toBe(0); // min 0
    expect(s.maxRetries).toBe(10); // max 10
    expect(s.batchCharBudget).toBe(200); // min 200
    expect(s.maxSegmentsPerBatch).toBe(100); // max 100
  });

  it("coerces non-finite numbers to defaults", () => {
    const s = normalizeSettings({
      concurrency: NaN as unknown as number,
      batchCharBudget: "abc" as unknown as number,
    });
    expect(s.concurrency).toBe(DEFAULT_SETTINGS.concurrency);
    expect(s.batchCharBudget).toBe(DEFAULT_SETTINGS.batchCharBudget);
  });

  it("trims custom instructions and coerces non-strings to empty", () => {
    expect(normalizeSettings({ customInstructions: "  glossary  " }).customInstructions).toBe("glossary");
    expect(normalizeSettings({ customInstructions: 42 as unknown as string }).customInstructions).toBe("");
    expect(normalizeSettings({}).customInstructions).toBe("");
  });

  it("only accepts valid display modes", () => {
    expect(normalizeSettings({ defaultDisplayMode: "translation-only" }).defaultDisplayMode).toBe(
      "translation-only"
    );
    expect(normalizeSettings({ defaultDisplayMode: "weird" as never }).defaultDisplayMode).toBe(
      "bilingual"
    );
  });

  it("only accepts valid FAB visibilities and translation styles", () => {
    expect(normalizeSettings({ showFab: "mobile" }).showFab).toBe("mobile");
    expect(normalizeSettings({ showFab: "sometimes" as never }).showFab).toBe("always");
    expect(normalizeSettings({ translationStyle: "mask" }).translationStyle).toBe("mask");
    expect(normalizeSettings({ translationStyle: "neon" as never }).translationStyle).toBe("border");
  });

  it("persistCache defaults to true and only accepts booleans", () => {
    expect(normalizeSettings({}).persistCache).toBe(true);
    expect(normalizeSettings({ persistCache: false }).persistCache).toBe(false);
    expect(normalizeSettings({ persistCache: "no" as never }).persistCache).toBe(true);
  });
});

describe("provider presets", () => {
  it("every preset has a usable baseUrl and model", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.baseUrl).toMatch(/^https?:\/\//);
      expect(p.model.length).toBeGreaterThan(0);
    }
  });

  it("preset ids are unique", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches a preset by base URL, ignoring trailing slashes and case", () => {
    expect(matchPreset("https://api.deepseek.com")?.id).toBe("deepseek");
    expect(matchPreset("https://api.deepseek.com/")?.id).toBe("deepseek");
    expect(matchPreset("HTTPS://API.DEEPSEEK.COM")?.id).toBe("deepseek");
    expect(matchPreset("https://api.openai.com/v1")?.id).toBe("openai");
  });

  it("returns null for unknown endpoints (custom)", () => {
    expect(matchPreset("https://my-proxy.example.com/v1")).toBeNull();
    expect(matchPreset("")).toBeNull();
  });

  it("the DeepSeek preset matches the shipped defaults", () => {
    const p = matchPreset(DEFAULT_SETTINGS.baseUrl);
    expect(p?.id).toBe("deepseek");
    expect(p?.model).toBe(DEFAULT_SETTINGS.model);
  });
});

describe("toProviderConfig / isConfigured", () => {
  it("projects the provider-relevant fields", () => {
    const s = normalizeSettings({ apiKey: "k", model: "m", targetLang: "fr", baseUrl: "https://x" });
    expect(toProviderConfig(s)).toEqual({
      apiKey: "k",
      baseUrl: "https://x",
      model: "m",
      targetLang: "fr",
      customInstructions: "",
    });
  });

  it("requires a non-empty API key", () => {
    expect(isConfigured(normalizeSettings({ apiKey: "" }))).toBe(false);
    expect(isConfigured(normalizeSettings({ apiKey: "   " }))).toBe(false);
    expect(isConfigured(normalizeSettings({ apiKey: "sk-1" }))).toBe(true);
  });
});
