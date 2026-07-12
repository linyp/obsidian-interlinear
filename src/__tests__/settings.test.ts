import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  toProviderConfig,
  isConfigured,
  isInsecureBaseUrl,
  matchPreset,
  applyProviderPreset,
  applyMtServicePreset,
  cacheIdentity,
  providerConfigSignature,
  PROVIDER_PRESETS,
  MT_SERVICE_PRESETS,
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
});

describe("isInsecureBaseUrl", () => {
  it("flags plain http to remote hosts (the key would travel unencrypted)", () => {
    expect(isInsecureBaseUrl("http://api.example.com/v1")).toBe(true);
    expect(isInsecureBaseUrl("HTTP://EXAMPLE.COM")).toBe(true);
    expect(isInsecureBaseUrl("http://192.168.1.5:8080/v1")).toBe(true);
  });

  it("allows http to local hosts (Ollama and friends)", () => {
    expect(isInsecureBaseUrl("http://localhost:11434/v1")).toBe(false);
    expect(isInsecureBaseUrl("http://LOCALHOST:11434")).toBe(false);
    expect(isInsecureBaseUrl("http://127.0.0.1:11434/v1")).toBe(false);
    expect(isInsecureBaseUrl("http://[::1]:11434/v1")).toBe(false);
  });

  it("stays silent for https, empty, and unparsable values", () => {
    expect(isInsecureBaseUrl("https://api.deepseek.com")).toBe(false);
    expect(isInsecureBaseUrl("https://api.example.com/v1")).toBe(false);
    expect(isInsecureBaseUrl("")).toBe(false);
    expect(isInsecureBaseUrl("not a url")).toBe(false);
  });
});

describe("translation service (traditional MT additions)", () => {
  it("defaults to the llm service and empty credentials (upgrade path)", () => {
    // An old data.json (no service fields at all) lands on llm — existing
    // users see zero behaviour change.
    const s = normalizeSettings({ apiKey: "sk-old", baseUrl: "https://api.deepseek.com" });
    expect(s.service).toBe("llm");
    expect(s.baidu).toEqual({ appId: "", appSecret: "" });
    expect(s.youdao).toEqual({ appKey: "", appSecret: "" });
  });

  it("falls back to llm on an unknown service value", () => {
    expect(normalizeSettings({ service: "bing" as never }).service).toBe("llm");
    expect(normalizeSettings({ service: 42 as never }).service).toBe("llm");
  });

  it("normalizes partial/garbage credential sub-objects to empty strings", () => {
    const s = normalizeSettings({
      baidu: { appId: 42 } as never,
      youdao: { appKey: "y-key", extra: true } as never,
    });
    expect(s.baidu).toEqual({ appId: "", appSecret: "" });
    expect(s.youdao).toEqual({ appKey: "y-key", appSecret: "" });
    expect(normalizeSettings({ baidu: null as never }).baidu).toEqual({ appId: "", appSecret: "" });
  });

  it("isConfigured checks the ACTIVE service's credentials", () => {
    expect(isConfigured(normalizeSettings({ service: "baidu", apiKey: "sk-llm-only" }))).toBe(false);
    expect(
      isConfigured(normalizeSettings({ service: "baidu", baidu: { appId: "1", appSecret: "" } }))
    ).toBe(false);
    expect(
      isConfigured(normalizeSettings({ service: "baidu", baidu: { appId: "1", appSecret: "s" } }))
    ).toBe(true);
    expect(
      isConfigured(normalizeSettings({ service: "youdao", youdao: { appKey: "k", appSecret: " " } }))
    ).toBe(false);
    expect(
      isConfigured(normalizeSettings({ service: "youdao", youdao: { appKey: "k", appSecret: "s" } }))
    ).toBe(true);
  });

  it("cacheIdentity keeps the bare model for llm and prefixes MT services", () => {
    expect(cacheIdentity(normalizeSettings({ model: "deepseek-v4-flash" }))).toBe("deepseek-v4-flash");
    expect(cacheIdentity(normalizeSettings({ service: "youdao" }))).toBe("mt:youdao");
    expect(cacheIdentity(normalizeSettings({ service: "baidu" }))).toBe("mt:baidu");
    // A model literally named like a service can never collide with it.
    expect(cacheIdentity(normalizeSettings({ model: "baidu" }))).not.toBe(
      cacheIdentity(normalizeSettings({ service: "baidu" }))
    );
  });

  it("MT preset ids are unique, don't collide with LLM preset ids, and tuning is in range", () => {
    const ids = MT_SERVICE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of MT_SERVICE_PRESETS) {
      expect(PROVIDER_PRESETS.some((llm) => llm.id === p.id)).toBe(false);
      expect(p.advanced.concurrency).toBeGreaterThanOrEqual(1);
      expect(p.advanced.concurrency).toBeLessThanOrEqual(16);
      expect(p.advanced.minIntervalMs).toBeGreaterThanOrEqual(0);
      expect(p.advanced.batchCharBudget).toBeGreaterThanOrEqual(200);
      expect(p.advanced.maxSegmentsPerBatch).toBeGreaterThanOrEqual(1);
    }
  });

  it("Youdao's preset stays strictly serial (low console-assigned QPS quotas)", () => {
    const p = MT_SERVICE_PRESETS.find((x) => x.id === "youdao")!;
    expect(p.advanced.concurrency).toBe(1);
    expect(p.advanced.minIntervalMs).toBeGreaterThanOrEqual(1000);
    expect(p.advanced.maxSegmentsPerBatch).toBe(1);
  });

  it("Baidu's preset stays under the verified plan's 10 QPS, one text per request", () => {
    const p = MT_SERVICE_PRESETS.find((x) => x.id === "baidu")!;
    // minIntervalMs is a GLOBAL start spacing in runPool, so ≥100 ms means
    // at most 10 request starts/second regardless of concurrency.
    expect(p.advanced.minIntervalMs).toBeGreaterThanOrEqual(100);
    expect(p.advanced.maxSegmentsPerBatch).toBe(1);
  });

  it("applyMtServicePreset switches service + tuning but keeps LLM fields and other creds", () => {
    const base = normalizeSettings({
      apiKey: "sk-keep",
      baseUrl: "https://my-proxy.example.com/v1",
      model: "my-model",
      customInstructions: "glossary",
      youdao: { appKey: "y-keep", appSecret: "s-keep" },
    });
    const baidu = MT_SERVICE_PRESETS.find((p) => p.id === "baidu")!;
    const s = applyMtServicePreset(base, baidu);
    expect(s.service).toBe("baidu");
    expect(s.concurrency).toBe(2);
    expect(s.minIntervalMs).toBe(150);
    expect(s.maxSegmentsPerBatch).toBe(1);
    // Nothing else lost:
    expect(s.apiKey).toBe("sk-keep");
    expect(s.baseUrl).toBe("https://my-proxy.example.com/v1");
    expect(s.model).toBe("my-model");
    expect(s.customInstructions).toBe("glossary");
    expect(s.youdao).toEqual({ appKey: "y-keep", appSecret: "s-keep" });
  });

  it("applyProviderPreset switches back to the llm service", () => {
    const onBaidu = applyMtServicePreset(
      normalizeSettings({}),
      MT_SERVICE_PRESETS.find((p) => p.id === "baidu")!
    );
    const openai = PROVIDER_PRESETS.find((p) => p.id === "openai")!;
    const s = applyProviderPreset(onBaidu, openai);
    expect(s.service).toBe("llm");
    expect(s.baseUrl).toBe(openai.baseUrl);
  });

  it("signature changes on service switch and active-credential edits only", () => {
    const llm = normalizeSettings({ apiKey: "k" });
    const onYoudao = normalizeSettings({
      ...llm,
      service: "youdao",
      youdao: { appKey: "y1", appSecret: "s1" },
    });
    expect(providerConfigSignature(onYoudao)).not.toBe(providerConfigSignature(llm));
    // Active credential change -> new signature.
    expect(
      providerConfigSignature(
        normalizeSettings({ ...onYoudao, youdao: { appKey: "y1", appSecret: "s2" } })
      )
    ).not.toBe(providerConfigSignature(onYoudao));
    // Target language affects every service's signature.
    expect(
      providerConfigSignature(normalizeSettings({ ...onYoudao, targetLang: "ja" }))
    ).not.toBe(providerConfigSignature(onYoudao));
    // INACTIVE credential edits (llm key, baidu creds while youdao is active)
    // must NOT invalidate the failed-set.
    expect(
      providerConfigSignature(normalizeSettings({ ...onYoudao, apiKey: "k2" }))
    ).toBe(providerConfigSignature(onYoudao));
    expect(
      providerConfigSignature(
        normalizeSettings({ ...onYoudao, baidu: { appId: "1", appSecret: "s" } })
      )
    ).toBe(providerConfigSignature(onYoudao));
  });
});
