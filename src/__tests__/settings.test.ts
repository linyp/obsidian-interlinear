import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  toProviderConfig,
  isConfigured,
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

  it("only accepts valid display modes", () => {
    expect(normalizeSettings({ defaultDisplayMode: "translation-only" }).defaultDisplayMode).toBe(
      "translation-only"
    );
    expect(normalizeSettings({ defaultDisplayMode: "weird" as never }).defaultDisplayMode).toBe(
      "bilingual"
    );
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
    });
  });

  it("requires a non-empty API key", () => {
    expect(isConfigured(normalizeSettings({ apiKey: "" }))).toBe(false);
    expect(isConfigured(normalizeSettings({ apiKey: "   " }))).toBe(false);
    expect(isConfigured(normalizeSettings({ apiKey: "sk-1" }))).toBe(true);
  });
});
