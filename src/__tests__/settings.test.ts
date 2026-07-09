import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  toProviderConfig,
  cacheModel,
  BAIDU_CACHE_MODEL,
  isConfigured,
  matchPreset,
  applyProviderPreset,
  providerConfigSignature,
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
    expect(normalizeSettings({ showFab: "always" }).showFab).toBe("always");
    expect(normalizeSettings({ showFab: "sometimes" as never }).showFab).toBe("mobile");
    expect(normalizeSettings({}).showFab).toBe("mobile"); // default: mobile only
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
  it("every OpenAI-compatible preset has a usable baseUrl and model", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.id.length).toBeGreaterThan(0);
      if ((p.kind ?? "openai") === "openai") {
        expect(p.baseUrl).toMatch(/^https?:\/\//);
        expect(p.model.length).toBeGreaterThan(0);
      }
    }
  });

  it("the Baidu preset carries kind:'baidu' and leaves baseUrl/model blank", () => {
    // The Baidu preset repurposes baseUrl for the APP ID (user-supplied) and
    // ignores model entirely — both must be blank so applying it doesn't
    // clobber existing user input.
    const baidu = PROVIDER_PRESETS.find((p) => p.id === "baidu");
    expect(baidu).toBeDefined();
    expect(baidu!.kind).toBe("baidu");
    expect(baidu!.baseUrl).toBe("");
    expect(baidu!.model).toBe("");
  });

  it("preset ids are unique", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches a preset by base URL, ignoring trailing slashes and case", () => {
    const s = (baseUrl: string) => normalizeSettings({ baseUrl });
    expect(matchPreset(s("https://api.deepseek.com"))?.id).toBe("deepseek");
    expect(matchPreset(s("https://api.deepseek.com/"))?.id).toBe("deepseek");
    expect(matchPreset(s("HTTPS://API.DEEPSEEK.COM"))?.id).toBe("deepseek");
    expect(matchPreset(s("https://api.openai.com/v1"))?.id).toBe("openai");
  });

  it("returns null for unknown endpoints (custom)", () => {
    expect(matchPreset(normalizeSettings({ baseUrl: "https://my-proxy.example.com/v1" }))).toBeNull();
    // An empty baseUrl falls back to the DeepSeek default and thus matches.
    expect(matchPreset(normalizeSettings({ baseUrl: "" }))?.id).toBe("deepseek");
  });

  it("the DeepSeek preset matches the shipped defaults", () => {
    const p = matchPreset(DEFAULT_SETTINGS);
    expect(p?.id).toBe("deepseek");
    expect(p?.model).toBe(DEFAULT_SETTINGS.model);
  });

  it("identifies the Baidu preset by kind, ignoring the base URL contents", () => {
    // For providerKind:"baidu" the base URL carries an APP ID, not a service
    // origin, so we must match by kind regardless of what URL is stored.
    const s = normalizeSettings({ providerKind: "baidu", baseUrl: "20150630000000001" });
    const matched = matchPreset(s);
    expect(matched?.id).toBe("baidu");
    expect(matched?.kind).toBe("baidu");
  });

  it("every preset declares a full, in-range Advanced tuning block", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.advanced).toBeDefined();
      const adv = p.advanced!;
      // Full set so switching is deterministic regardless of the prior preset.
      expect(adv.concurrency).toBeGreaterThanOrEqual(1);
      expect(adv.concurrency).toBeLessThanOrEqual(16);
      expect(adv.minIntervalMs).toBeGreaterThanOrEqual(0);
      expect(adv.maxRetries).toBeGreaterThanOrEqual(0);
      expect(adv.batchCharBudget).toBeGreaterThanOrEqual(200);
      expect(adv.maxSegmentsPerBatch).toBeGreaterThanOrEqual(1);
    }
  });
  it("the DeepSeek preset's Advanced tuning equals the shipped defaults", () => {
    const ds = PROVIDER_PRESETS.find((p) => p.id === "deepseek")!;
    expect(ds.advanced).toMatchObject({
      concurrency: DEFAULT_SETTINGS.concurrency,
      minIntervalMs: DEFAULT_SETTINGS.minIntervalMs,
      maxRetries: DEFAULT_SETTINGS.maxRetries,
      batchCharBudget: DEFAULT_SETTINGS.batchCharBudget,
      maxSegmentsPerBatch: DEFAULT_SETTINGS.maxSegmentsPerBatch,
    });
  });
});

describe("applyProviderPreset", () => {
  const base = normalizeSettings({ apiKey: "sk-keep", targetLang: "en", customInstructions: "glossary" });

  it("sets baseUrl + model and the preset's Advanced tuning", () => {
    const openai = PROVIDER_PRESETS.find((p) => p.id === "openai")!;
    const s = applyProviderPreset(base, openai);
    expect(s.baseUrl).toBe(openai.baseUrl);
    expect(s.model).toBe(openai.model);
    expect(s.concurrency).toBe(4);
    expect(s.minIntervalMs).toBe(200);
    expect(s.maxRetries).toBe(4);
  });

  it("overwrites previously customized Advanced values (overwrite semantics)", () => {
    const tuned = normalizeSettings({ ...base, concurrency: 1, minIntervalMs: 5000, batchCharBudget: 800 });
    const ollama = PROVIDER_PRESETS.find((p) => p.id === "ollama")!;
    const s = applyProviderPreset(tuned, ollama);
    expect(s.concurrency).toBe(2);
    expect(s.minIntervalMs).toBe(0);
    expect(s.batchCharBudget).toBe(2000);
    expect(s.maxSegmentsPerBatch).toBe(6);
  });

  it("is deterministic regardless of the previously selected preset", () => {
    const ollama = PROVIDER_PRESETS.find((p) => p.id === "ollama")!;
    const openai = PROVIDER_PRESETS.find((p) => p.id === "openai")!;
    const viaOllama = applyProviderPreset(applyProviderPreset(base, ollama), openai);
    const direct = applyProviderPreset(base, openai);
    // Ollama's small batch sizes must not leak into OpenAI's tuning.
    expect(viaOllama.batchCharBudget).toBe(4000);
    expect(viaOllama.maxSegmentsPerBatch).toBe(12);
    expect(viaOllama).toEqual(direct);
  });

  it("preserves non-service settings (api key, target language, instructions)", () => {
    const deepseek = PROVIDER_PRESETS.find((p) => p.id === "deepseek")!;
    const s = applyProviderPreset(base, deepseek);
    expect(s.apiKey).toBe("sk-keep");
    expect(s.targetLang).toBe("en");
    expect(s.customInstructions).toBe("glossary");
  });

  it("clamps a preset's out-of-range tuning via normalizeSettings", () => {
    const bad = { id: "x", label: "x", baseUrl: "https://x", model: "m", advanced: { concurrency: 999 } };
    expect(applyProviderPreset(base, bad).concurrency).toBe(16); // clamped to max
  });

  it("switching to the Baidu preset flips providerKind and blanks baseUrl/model", () => {
    const baidu = PROVIDER_PRESETS.find((p) => p.id === "baidu")!;
    const s = applyProviderPreset(base, baidu);
    expect(s.providerKind).toBe("baidu");
    // Preset carries no baseUrl/model — user fills in APP ID afterwards.
    expect(s.baseUrl).toBe("");
    expect(s.model).toBe("");
    // Applied advanced tuning (Baidu standard-tier QPS=1 shape).
    expect(s.concurrency).toBe(1);
    expect(s.minIntervalMs).toBeGreaterThan(0);
  });

  it("switching from Baidu back to an OpenAI preset restores providerKind + defaults", () => {
    const baidu = PROVIDER_PRESETS.find((p) => p.id === "baidu")!;
    const deepseek = PROVIDER_PRESETS.find((p) => p.id === "deepseek")!;
    const s = applyProviderPreset(applyProviderPreset(base, baidu), deepseek);
    expect(s.providerKind).toBe("openai");
    expect(s.baseUrl).toBe(deepseek.baseUrl);
    expect(s.model).toBe(deepseek.model);
    // Deepseek's advanced tuning applied, not Baidu's residual QPS=1.
    expect(s.concurrency).toBe(10);
  });
});

describe("providerConfigSignature", () => {
  const base = normalizeSettings({ apiKey: "k", baseUrl: "https://x", model: "m", targetLang: "en" });

  it("changes when any provider field changes", () => {
    const sig = providerConfigSignature(base);
    expect(providerConfigSignature(normalizeSettings({ ...base, apiKey: "k2" }))).not.toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, baseUrl: "https://y" }))).not.toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, model: "m2" }))).not.toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, targetLang: "ja" }))).not.toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, customInstructions: "glossary" }))).not.toBe(sig);
  });

  it("is stable when only non-provider fields change", () => {
    const sig = providerConfigSignature(base);
    expect(providerConfigSignature(normalizeSettings({ ...base, concurrency: 3 }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, minIntervalMs: 500 }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, maxRetries: 7 }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, batchCharBudget: 1000 }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, translationStyle: "mask" }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, showFab: "always" }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, persistCache: false }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, defaultDisplayMode: "translation-only" }))).toBe(sig);
  });

  it("treats a preset switch as a config change (baseUrl/model differ)", () => {
    const openai = PROVIDER_PRESETS.find((p) => p.id === "openai")!;
    expect(providerConfigSignature(applyProviderPreset(base, openai))).not.toBe(providerConfigSignature(base));
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

  it("Baidu also requires a non-empty baseUrl (the APP ID)", () => {
    // APP ID lives in the baseUrl field for Baidu — key alone isn't enough.
    expect(isConfigured(normalizeSettings({ providerKind: "baidu", apiKey: "secret", baseUrl: "" }))).toBe(
      false
    );
    expect(isConfigured(normalizeSettings({ providerKind: "baidu", apiKey: "secret", baseUrl: "20150001" }))).toBe(
      true
    );
  });
});

describe("cacheModel", () => {
  it("returns the model name for OpenAI-compatible settings", () => {
    const s = normalizeSettings({ model: "gpt-4o-mini" });
    expect(cacheModel(s)).toBe("gpt-4o-mini");
  });

  it("returns a stable constant for Baidu regardless of the ignored model input", () => {
    // The Model field is displayed but not used on the wire for Baidu, so
    // whatever the user types there must NOT drift the cache key.
    const a = normalizeSettings({ providerKind: "baidu", apiKey: "s", baseUrl: "APPID", model: "" });
    const b = normalizeSettings({ providerKind: "baidu", apiKey: "s", baseUrl: "APPID", model: "junk" });
    expect(cacheModel(a)).toBe(BAIDU_CACHE_MODEL);
    expect(cacheModel(b)).toBe(BAIDU_CACHE_MODEL);
    expect(cacheModel(a)).toBe(cacheModel(b));
  });
});

describe("providerKind persistence", () => {
  it("defaults to 'openai' when absent (backward-compat with pre-Baidu data.json)", () => {
    expect(normalizeSettings({}).providerKind).toBe("openai");
    expect(normalizeSettings({ apiKey: "sk" }).providerKind).toBe("openai");
  });

  it("only accepts known kinds; unknown values fall back to the default", () => {
    expect(normalizeSettings({ providerKind: "baidu" }).providerKind).toBe("baidu");
    expect(normalizeSettings({ providerKind: "openai" }).providerKind).toBe("openai");
    expect(normalizeSettings({ providerKind: "gemini" as never }).providerKind).toBe("openai");
  });

  it("preserves an empty baseUrl/model for the Baidu kind (they carry APP ID / are unused)", () => {
    const s = normalizeSettings({ providerKind: "baidu", baseUrl: "", model: "" });
    expect(s.baseUrl).toBe("");
    expect(s.model).toBe("");
  });

  it("still falls back to the DeepSeek default for OpenAI kind with a blank baseUrl", () => {
    const s = normalizeSettings({ providerKind: "openai", baseUrl: "", model: "" });
    expect(s.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);
    expect(s.model).toBe(DEFAULT_SETTINGS.model);
  });
});
