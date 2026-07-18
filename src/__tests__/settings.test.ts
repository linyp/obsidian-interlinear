import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  toProviderConfig,
  isConfigured,
  isInsecureBaseUrl,
  matchPreset,
  selectPreset,
  updateActivePreset,
  getActiveLlmSettings,
  getActivePresetSettings,
  createDefaultBaiduPreset,
  createDefaultYoudaoPreset,
  isLegacySettingsData,
  migrateLegacySettings,
  normalizeLlmEndpointFieldOnBlur,
  cacheIdentity,
  translationResultSignature,
  providerConfigSignature,
  PROVIDER_PRESETS,
  MT_SERVICE_PRESETS,
  SETTINGS_SCHEMA_VERSION,
  UnsupportedSettingsSchemaVersionError,
  backupMatchesSchemaVersion,
  loadStoredSettings,
} from "../settings";

describe("normalizeSettings", () => {
  it("returns defaults for null/undefined/non-object input", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial stored data over defaults", () => {
    const s = normalizeSettings({ apiKey: "sk-x", targetLang: "en" });
    expect(getActiveLlmSettings(s)?.apiKey).toBe("sk-x");
    expect(s.targetLang).toBe("en");
    expect(getActiveLlmSettings(s)?.model).toBe(getActiveLlmSettings(DEFAULT_SETTINGS)?.model);
  });

  it("falls back empty/whitespace strings to defaults", () => {
    const s = normalizeSettings({ baseUrl: "   ", model: "", targetLang: "" });
    expect(getActiveLlmSettings(s)?.baseUrl).toBe(getActiveLlmSettings(DEFAULT_SETTINGS)?.baseUrl);
    expect(getActiveLlmSettings(s)?.model).toBe(getActiveLlmSettings(DEFAULT_SETTINGS)?.model);
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
    const active = getActivePresetSettings(s);
    expect(active.concurrency).toBe(1); // min 1
    expect(active.minIntervalMs).toBe(0); // min 0
    expect(active.maxRetries).toBe(10); // max 10
    expect(active.batchCharBudget).toBe(200); // min 200
    expect(active.maxSegmentsPerBatch).toBe(100); // max 100
  });

  it("coerces non-finite numbers to defaults", () => {
    const s = normalizeSettings({
      concurrency: NaN as unknown as number,
      batchCharBudget: "abc" as unknown as number,
    });
    const active = getActivePresetSettings(s);
    const defaults = getActivePresetSettings(DEFAULT_SETTINGS);
    expect(active.concurrency).toBe(defaults.concurrency);
    expect(active.batchCharBudget).toBe(defaults.batchCharBudget);
  });

  it("trims custom instructions and coerces non-strings to empty", () => {
    expect(getActiveLlmSettings(normalizeSettings({ customInstructions: "  glossary  " }))?.customInstructions).toBe("glossary");
    expect(getActiveLlmSettings(normalizeSettings({ customInstructions: 42 as unknown as string }))?.customInstructions).toBe("");
    expect(getActiveLlmSettings(normalizeSettings({}))?.customInstructions).toBe("");
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

describe("settings schema routing", () => {
  it("writes the current schema version into defaults and normalized data", () => {
    expect(DEFAULT_SETTINGS.settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(normalizeSettings(null).settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it("treats missing versions as v1 even when presets are present", () => {
    const unversioned = {
      service: "custom",
      presets: {
        llm: {
          custom: {
            apiKey: "nested-key",
            baseUrl: "https://nested.example.com/v1",
            model: "nested-model",
          },
        },
        mt: {},
      },
    };

    expect(isLegacySettingsData(unversioned)).toBe(true);
    const migrated = normalizeSettings(unversioned);
    expect(migrated.settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(migrated.service).toBe("deepseek");
    expect(migrated.presets.llm.custom).toBeUndefined();
  });

  it("normalizes the current schema directly without migration", () => {
    const normalized = normalizeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      service: "custom",
      targetLang: "ja",
      presets: {
        llm: {
          custom: {
            apiKey: "nested-key",
            baseUrl: "https://nested.example.com/v1",
            model: "nested-model",
          },
        },
        mt: {},
      },
    });

    expect(normalized.service).toBe("custom");
    expect(normalized.targetLang).toBe("ja");
    expect(normalized.presets.llm.custom).toMatchObject({
      apiKey: "nested-key",
      baseUrl: "https://nested.example.com/v1",
      model: "nested-model",
    });
  });

  it("accepts every supported version and rejects future or invalid versions", () => {
    for (let version = 1; version <= SETTINGS_SCHEMA_VERSION; version++) {
      expect(() => normalizeSettings({ settingsSchemaVersion: version })).not.toThrow();
    }
    expect(() =>
      normalizeSettings({ settingsSchemaVersion: SETTINGS_SCHEMA_VERSION + 1 })
    ).toThrow(
      UnsupportedSettingsSchemaVersionError
    );
    expect(() =>
      normalizeSettings({ settingsSchemaVersion: String(SETTINGS_SCHEMA_VERSION) })
    ).toThrow(/must be an integer <=/);
    expect(() => normalizeSettings({ settingsSchemaVersion: 0 })).toThrow(
      UnsupportedSettingsSchemaVersionError
    );
  });
});

describe("legacy data.json migration", () => {
  const oldData = {
    service: "llm",
    apiKey: "sk-A",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    baidu: { appId: "ididid", appSecret: "sk-B" },
    youdao: { appKey: "", appSecret: "" },
    defaultDisplayMode: "bilingual",
    targetLang: "zh-CN",
    concurrency: 10,
    minIntervalMs: 0,
    maxRetries: 3,
    batchCharBudget: 4000,
    maxSegmentsPerBatch: 12,
    customInstructions: "",
    showFab: "mobile",
    translationStyle: "dashed",
    persistCache: true,
  };

  it("recognizes old flat data but never re-migrates new nested data", () => {
    expect(isLegacySettingsData(oldData)).toBe(true);
    const migrated = migrateLegacySettings(oldData);
    expect(isLegacySettingsData(migrated)).toBe(false);
    expect(normalizeSettings(migrated)).toEqual(migrated);
  });

  it("converts the old shape and omits an empty inactive MT preset", () => {
    const s = migrateLegacySettings(oldData);
    expect(s.service).toBe("deepseek");
    expect(s.translationStyle).toBe("dashed");
    expect(s.presets.llm.deepseek).toMatchObject({ apiKey: "sk-A", concurrency: 10 });
    expect(s.presets.mt.baidu).toEqual({
      ...createDefaultBaiduPreset(),
      appId: "ididid",
      appSecret: "sk-B",
    });
    expect(s.presets.mt.youdao).toBeUndefined();
  });

  it("infers every known LLM preset from its URL", () => {
    for (const p of PROVIDER_PRESETS) {
      const s = migrateLegacySettings({ service: "llm", baseUrl: p.baseUrl + "/", model: "m" });
      expect(s.service).toBe(p.id);
      expect(s.presets.llm[p.id]?.model).toBe("m");
    }
  });

  it("falls back to custom for an unknown URL", () => {
    const s = migrateLegacySettings({
      service: "llm",
      apiKey: "k",
      baseUrl: "https://proxy.example.com/v1",
      model: "proxy-model",
    });
    expect(s.service).toBe("custom");
    expect(s.presets.llm.custom).toMatchObject({
      apiKey: "k",
      baseUrl: "https://proxy.example.com/v1",
      model: "proxy-model",
    });
  });

  for (const service of ["baidu", "youdao"] as const) {
    it(`preserves all records when ${service} is the active v1 service`, () => {
      const migrated = normalizeSettings({
        settingsSchemaVersion: 1,
        service,
        apiKey: "sk-llm",
        baseUrl: "https://api.deepseek.com/v1",
        model: "legacy-model",
        customInstructions: "legacy glossary",
        baidu: { appId: "baidu-id", appSecret: "baidu-secret" },
        youdao: { appKey: "youdao-key", appSecret: "youdao-secret" },
        concurrency: 7,
        minIntervalMs: 777,
        maxRetries: 8,
        batchCharBudget: 2345,
        maxSegmentsPerBatch: 9,
        defaultDisplayMode: "translation-only",
        targetLang: "ja",
        showFab: "always",
        translationStyle: "mask",
        persistCache: false,
      });

      expect(migrated.service).toBe(service);
      expect(getActivePresetSettings(migrated)).toMatchObject({
        ...(service === "baidu"
          ? { appId: "baidu-id", appSecret: "baidu-secret" }
          : { appKey: "youdao-key", appSecret: "youdao-secret" }),
        concurrency: 7,
        minIntervalMs: 777,
        maxRetries: 8,
        batchCharBudget: 2345,
        maxSegmentsPerBatch: 9,
      });

      const inactiveMt =
        service === "baidu" ? migrated.presets.mt.youdao : migrated.presets.mt.baidu;
      expect(inactiveMt).toEqual({
        ...(service === "baidu"
          ? createDefaultYoudaoPreset()
          : createDefaultBaiduPreset()),
        ...(service === "baidu"
          ? { appKey: "youdao-key", appSecret: "youdao-secret" }
          : { appId: "baidu-id", appSecret: "baidu-secret" }),
      });

      const llmDefaults = getActivePresetSettings(DEFAULT_SETTINGS);
      expect(migrated.presets.llm.deepseek).toMatchObject({
        apiKey: "sk-llm",
        baseUrl: "https://api.deepseek.com/v1",
        model: "legacy-model",
        customInstructions: "legacy glossary",
        concurrency: llmDefaults.concurrency,
        minIntervalMs: llmDefaults.minIntervalMs,
        maxRetries: llmDefaults.maxRetries,
        batchCharBudget: llmDefaults.batchCharBudget,
        maxSegmentsPerBatch: llmDefaults.maxSegmentsPerBatch,
      });
      expect(migrated).toMatchObject({
        settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
        defaultDisplayMode: "translation-only",
        targetLang: "ja",
        showFab: "always",
        translationStyle: "mask",
        persistCache: false,
      });
      expect(normalizeSettings(migrated)).toEqual(migrated);
      expect(normalizeSettings(JSON.parse(JSON.stringify(migrated)) as unknown)).toEqual(migrated);
    });
  }
});

describe("stored settings migration", () => {
  const v1 = {
    service: "llm",
    apiKey: "sk-private",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  };

  function migrationHarness(options: {
    backup?: string | null;
    readFails?: boolean;
    writeFails?: boolean;
  } = {}) {
    const state: { events: string[]; backup: string | null; saved?: unknown } = {
      events: [],
      backup: options.backup ?? null,
    };
    return {
      state,
      io: {
        readBackup: async () => {
          state.events.push("read");
          if (options.readFails) throw new Error("disk failure with irrelevant details");
          return state.backup;
        },
        writeBackup: async (data: string) => {
          state.events.push("backup");
          if (options.writeFails) throw new Error("disk failure with irrelevant details");
          state.backup = data;
        },
        writeSettings: async (settings: unknown) => {
          state.events.push("save");
          state.saved = settings;
        },
      },
    };
  }

  it("creates a backup before writing migrated settings", async () => {
    const { state, io } = migrationHarness();
    const loaded = await loadStoredSettings(v1, io);

    expect(state.events).toEqual(["read", "backup", "save"]);
    expect(JSON.parse(state.backup!)).toEqual(v1);
    expect(state.saved).toEqual(loaded);
    expect(loaded.settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it("keeps the existing backup when it matches the migration source version", async () => {
    const originalBackup = JSON.stringify({ ...v1, apiKey: "older-private-key" });
    const { state, io } = migrationHarness({ backup: originalBackup });
    await loadStoredSettings(v1, io);
    expect(state.events).toEqual(["read", "save"]);
    expect(state.backup).toBe(originalBackup);
  });

  it("replaces the backup when it does not match the migration source version", async () => {
    const { state, io } = migrationHarness({ backup: JSON.stringify(DEFAULT_SETTINGS) });
    await loadStoredSettings(v1, io);
    expect(state.events).toEqual(["read", "backup", "save"]);
    expect(JSON.parse(state.backup!)).toEqual(v1);
  });

  it("replaces a backup whose schema version cannot be determined", async () => {
    for (const invalidBackup of ["not json", JSON.stringify(["not", "settings"])]) {
      const { state, io } = migrationHarness({ backup: invalidBackup });
      await loadStoredSettings(v1, io);
      expect(state.events).toEqual(["read", "backup", "save"]);
      expect(JSON.parse(state.backup!)).toEqual(v1);
    }
  });

  it("does not migrate or overwrite data when backup creation fails", async () => {
    const { state, io } = migrationHarness({ writeFails: true });
    await expect(loadStoredSettings(v1, io)).rejects.toThrow(
      "failed to prepare the settings backup"
    );
    expect(state.events).toEqual(["read", "backup"]);
    expect(state.saved).toBeUndefined();
  });

  it("does not migrate or overwrite data when the backup cannot be read", async () => {
    const { state, io } = migrationHarness({ readFails: true });
    await expect(loadStoredSettings(v1, io)).rejects.toThrow(
      "failed to prepare the settings backup"
    );
    expect(state.events).toEqual(["read"]);
    expect(state.saved).toBeUndefined();
  });

  it("does not back up or write defaults when there is no stored data", async () => {
    const { state, io } = migrationHarness();
    const loaded = await loadStoredSettings(null, io);
    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(state.events).toEqual([]);
  });

  it("normalizes the current schema without any migration write", async () => {
    const { state, io } = migrationHarness();
    const loaded = await loadStoredSettings(
      { ...DEFAULT_SETTINGS, targetLang: "fr" },
      io
    );
    expect(loaded.targetLang).toBe("fr");
    expect(state.events).toEqual([]);
  });

  it("rejects future versions without any backup or settings write", async () => {
    const { state, io } = migrationHarness();
    await expect(
      loadStoredSettings({ settingsSchemaVersion: SETTINGS_SCHEMA_VERSION + 1 }, io)
    ).rejects.toBeInstanceOf(UnsupportedSettingsSchemaVersionError);
    expect(state.events).toEqual([]);
  });
});

describe("backup schema version matching", () => {
  it.each([1, 2, 3, 17])(
    "matches an existing backup for source schema v%i",
    (version) => {
      expect(
        backupMatchesSchemaVersion(
          JSON.stringify({ settingsSchemaVersion: version, marker: `v${version}` }),
          version
        )
      ).toBe(true);
    }
  );

  it.each([
    { backupVersion: 1, sourceVersion: 2 },
    { backupVersion: 2, sourceVersion: 1 },
    { backupVersion: 3, sourceVersion: 17 },
    { backupVersion: 17, sourceVersion: 3 },
  ])(
    "does not match backup v$backupVersion to source v$sourceVersion",
    ({ backupVersion, sourceVersion }) => {
      expect(
        backupMatchesSchemaVersion(
          JSON.stringify({ settingsSchemaVersion: backupVersion }),
          sourceVersion
        )
      ).toBe(false);
    }
  );

  it("treats an unversioned settings object as schema v1", () => {
    expect(backupMatchesSchemaVersion(JSON.stringify({ service: "llm" }), 1)).toBe(true);
    expect(backupMatchesSchemaVersion(JSON.stringify({ service: "llm" }), 2)).toBe(false);
  });

  it.each([null, "not json", "[]", "null", "42"])(
    "rejects missing or invalid settings backup %#",
    (backup) => {
      expect(backupMatchesSchemaVersion(backup, 1)).toBe(false);
    }
  );
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
    const defaults = getActiveLlmSettings(DEFAULT_SETTINGS)!;
    const p = matchPreset(defaults.baseUrl);
    expect(p?.id).toBe("deepseek");
    expect(p?.model).toBe(defaults.model);
  });

  it("every preset declares a full, in-range Advanced tuning block", () => {
    for (const p of PROVIDER_PRESETS) {
      expect(p.advanced).toBeDefined();
      const adv = p.advanced!;
      // Full set so first-time initialization is deterministic.
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
    const defaults = getActivePresetSettings(DEFAULT_SETTINGS);
    expect(ds.advanced).toMatchObject({
      concurrency: defaults.concurrency,
      minIntervalMs: defaults.minIntervalMs,
      maxRetries: defaults.maxRetries,
      batchCharBudget: defaults.batchCharBudget,
      maxSegmentsPerBatch: defaults.maxSegmentsPerBatch,
    });
  });
});

describe("normalizeLlmEndpointFieldOnBlur", () => {
  it("restores each known preset's defaults when endpoint fields are blank", () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(normalizeLlmEndpointFieldOnBlur(preset.id, "baseUrl", "   ")).toBe(
        preset.baseUrl
      );
      expect(normalizeLlmEndpointFieldOnBlur(preset.id, "model", "")).toBe(preset.model);
    }
  });

  it("keeps Custom blank and trims non-empty values", () => {
    expect(normalizeLlmEndpointFieldOnBlur("custom", "baseUrl", "   ")).toBe("");
    expect(normalizeLlmEndpointFieldOnBlur("custom", "model", "")).toBe("");
    expect(
      normalizeLlmEndpointFieldOnBlur("deepseek", "baseUrl", "  https://proxy.example/v1/  ")
    ).toBe("https://proxy.example/v1/");
    expect(normalizeLlmEndpointFieldOnBlur("deepseek", "model", "  custom-model  ")).toBe(
      "custom-model"
    );
  });
});

describe("selectPreset", () => {
  const base = normalizeSettings({ apiKey: "sk-keep", targetLang: "en", customInstructions: "glossary" });

  it("sets baseUrl + model and the preset's Advanced tuning on first selection", () => {
    const openai = PROVIDER_PRESETS.find((p) => p.id === "openai")!;
    const s = selectPreset(base, "openai");
    const active = getActiveLlmSettings(s)!;
    expect(active.baseUrl).toBe(openai.baseUrl);
    expect(active.model).toBe(openai.model);
    expect(active.concurrency).toBe(4);
    expect(active.minIntervalMs).toBe(200);
    expect(active.maxRetries).toBe(4);
  });

  it("restores previously customized values instead of overwriting them", () => {
    let s = selectPreset(base, "ollama");
    s = updateActivePreset(s, { concurrency: 1, minIntervalMs: 5000, batchCharBudget: 800 });
    s = selectPreset(s, "openai");
    s = selectPreset(s, "ollama");
    const active = getActivePresetSettings(s);
    expect(active.concurrency).toBe(1);
    expect(active.minIntervalMs).toBe(5000);
    expect(active.batchCharBudget).toBe(800);
  });

  it("is deterministic regardless of the previously selected preset", () => {
    const viaOllama = selectPreset(selectPreset(base, "ollama"), "openai");
    const direct = selectPreset(base, "openai");
    // Ollama's small batch sizes must not leak into OpenAI's tuning.
    expect(getActivePresetSettings(viaOllama)).toEqual(getActivePresetSettings(direct));
  });

  it("preserves non-service settings and other preset records", () => {
    const s = selectPreset(base, "openai");
    expect(getActiveLlmSettings(selectPreset(s, "deepseek"))?.apiKey).toBe("sk-keep");
    expect(s.targetLang).toBe("en");
    expect(getActiveLlmSettings(selectPreset(s, "deepseek"))?.customInstructions).toBe("glossary");
  });
});

describe("providerConfigSignature", () => {
  const base = normalizeSettings({ apiKey: "k", baseUrl: "https://x", model: "m", targetLang: "en" });

  it("changes when any provider field changes", () => {
    const sig = providerConfigSignature(base);
    expect(providerConfigSignature(updateActivePreset(base, { apiKey: "k2" }))).not.toBe(sig);
    expect(providerConfigSignature(updateActivePreset(base, { baseUrl: "https://y" }))).not.toBe(sig);
    expect(providerConfigSignature(updateActivePreset(base, { model: "m2" }))).not.toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, targetLang: "ja" }))).not.toBe(sig);
    expect(providerConfigSignature(updateActivePreset(base, { customInstructions: "glossary" }))).not.toBe(sig);
  });

  it("is stable when only non-provider fields change", () => {
    const sig = providerConfigSignature(base);
    expect(providerConfigSignature(updateActivePreset(base, { concurrency: 3 }))).toBe(sig);
    expect(providerConfigSignature(updateActivePreset(base, { minIntervalMs: 500 }))).toBe(sig);
    expect(providerConfigSignature(updateActivePreset(base, { maxRetries: 7 }))).toBe(sig);
    expect(providerConfigSignature(updateActivePreset(base, { batchCharBudget: 1000 }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, translationStyle: "mask" }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, showFab: "always" }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, persistCache: false }))).toBe(sig);
    expect(providerConfigSignature(normalizeSettings({ ...base, defaultDisplayMode: "translation-only" }))).toBe(sig);
  });

  it("treats a preset switch as a config change", () => {
    expect(providerConfigSignature(selectPreset(base, "openai"))).not.toBe(providerConfigSignature(base));
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
  it("defaults to the DeepSeek preset and sparse MT records (upgrade path)", () => {
    // An old data.json (no concrete preset id) lands on DeepSeek while its
    // existing LLM configuration is preserved.
    const s = normalizeSettings({ apiKey: "sk-old", baseUrl: "https://api.deepseek.com" });
    expect(s.service).toBe("deepseek");
    expect(s.presets.mt).toEqual({});
  });

  it("falls back to DeepSeek on an unknown service value", () => {
    expect(normalizeSettings({ service: "bing" as never }).service).toBe("deepseek");
    expect(normalizeSettings({ service: 42 as never }).service).toBe("deepseek");
  });

  it("normalizes partial/garbage credential sub-objects to empty strings", () => {
    const s = normalizeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      service: "baidu",
      presets: {
        llm: {},
        mt: {
          baidu: { appId: 42 },
          youdao: { appKey: "y-key", extra: true },
        },
      },
    });
    expect(s.presets.mt.baidu).toMatchObject({ appId: "", appSecret: "" });
    expect(s.presets.mt.youdao).toMatchObject({ appKey: "y-key", appSecret: "" });
  });

  it("isConfigured checks the ACTIVE service's credentials", () => {
    let s = selectPreset(normalizeSettings({ apiKey: "sk-llm-only" }), "baidu");
    expect(isConfigured(s)).toBe(false);
    s = updateActivePreset(s, { appId: "1", appSecret: "" });
    expect(isConfigured(s)).toBe(false);
    s = updateActivePreset(s, { appSecret: "s" });
    expect(isConfigured(s)).toBe(true);
    s = selectPreset(s, "youdao");
    s = updateActivePreset(s, { appKey: "k", appSecret: " " });
    expect(isConfigured(s)).toBe(false);
  });

  it("cacheIdentity keeps the bare model for empty LLM prompt context", () => {
    expect(cacheIdentity(normalizeSettings({ model: "deepseek-v4-flash" }))).toBe("deepseek-v4-flash");
    expect(cacheIdentity(selectPreset(normalizeSettings({}), "youdao"))).toBe("mt:youdao");
    expect(cacheIdentity(selectPreset(normalizeSettings({}), "baidu"))).toBe("mt:baidu");
    // A model literally named like a service can never collide with it.
    expect(cacheIdentity(normalizeSettings({ model: "baidu" }))).not.toBe(
      cacheIdentity(selectPreset(normalizeSettings({}), "baidu"))
    );
  });

  it("cacheIdentity changes with normalized Custom instructions", () => {
    const base = normalizeSettings({ model: "m", customInstructions: "" });
    const glossaryA = updateActivePreset(base, { customInstructions: "term = 术语" });
    const glossaryAWithSpace = updateActivePreset(base, {
      customInstructions: "  term = 术语  ",
    });
    const glossaryB = updateActivePreset(base, { customInstructions: "term = 词元" });

    expect(cacheIdentity(glossaryA)).toBe(cacheIdentity(glossaryAWithSpace));
    expect(cacheIdentity(glossaryA)).not.toBe(cacheIdentity(base));
    expect(cacheIdentity(glossaryB)).not.toBe(cacheIdentity(glossaryA));
  });

  it("translationResultSignature changes only when cached output identity changes", () => {
    const base = normalizeSettings({ apiKey: "k", model: "m", targetLang: "en" });
    expect(translationResultSignature(updateActivePreset(base, { apiKey: "k2" }))).toBe(
      translationResultSignature(base)
    );
    expect(translationResultSignature(updateActivePreset(base, { baseUrl: "https://y" }))).toBe(
      translationResultSignature(base)
    );
    expect(translationResultSignature(updateActivePreset(base, { customInstructions: "tone" }))).not.toBe(
      translationResultSignature(base)
    );
    expect(translationResultSignature(normalizeSettings({ ...base, targetLang: "ja" }))).not.toBe(
      translationResultSignature(base)
    );
  });

  it("MT preset ids are unique, don't collide with LLM preset ids, and tuning is in range", () => {
    const ids = MT_SERVICE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of MT_SERVICE_PRESETS) {
      expect(PROVIDER_PRESETS.some((llm) => String(llm.id) === p.id)).toBe(false);
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

  it("selectPreset creates MT tuning but keeps LLM fields and other creds", () => {
    const base = normalizeSettings({
      apiKey: "sk-keep",
      baseUrl: "https://my-proxy.example.com/v1",
      model: "my-model",
      customInstructions: "glossary",
      youdao: { appKey: "y-keep", appSecret: "s-keep" },
    });
    const s = selectPreset(base, "baidu");
    const active = getActivePresetSettings(s);
    expect(s.service).toBe("baidu");
    expect(active.concurrency).toBe(2);
    expect(active.minIntervalMs).toBe(150);
    expect(active.maxSegmentsPerBatch).toBe(1);
    // Nothing else lost:
    expect(s.presets.llm.custom).toMatchObject({ apiKey: "sk-keep", model: "my-model" });
    expect(s.presets.mt.youdao).toMatchObject({ appKey: "y-keep", appSecret: "s-keep" });
  });

  it("selectPreset switches back to an LLM preset", () => {
    const onBaidu = selectPreset(normalizeSettings({}), "baidu");
    const openai = PROVIDER_PRESETS.find((p) => p.id === "openai")!;
    const s = selectPreset(onBaidu, "openai");
    expect(s.service).toBe("openai");
    expect(getActiveLlmSettings(s)?.baseUrl).toBe(openai.baseUrl);
  });

  it("signature changes on service switch and active-credential edits only", () => {
    const llm = normalizeSettings({ apiKey: "k" });
    let onYoudao = selectPreset(llm, "youdao");
    onYoudao = updateActivePreset(onYoudao, { appKey: "y1", appSecret: "s1" });
    expect(providerConfigSignature(onYoudao)).not.toBe(providerConfigSignature(llm));
    // Active credential change -> new signature.
    expect(providerConfigSignature(updateActivePreset(onYoudao, { appSecret: "s2" }))).not.toBe(
      providerConfigSignature(onYoudao)
    );
    // Target language affects every service's signature.
    expect(providerConfigSignature(normalizeSettings({ ...onYoudao, targetLang: "ja" }))).not.toBe(
      providerConfigSignature(onYoudao)
    );
    // INACTIVE credential edits (llm key, baidu creds while youdao is active)
    // must NOT invalidate the failed-set.
    let inactiveEdit = selectPreset(onYoudao, "deepseek");
    inactiveEdit = updateActivePreset(inactiveEdit, { apiKey: "k2" });
    inactiveEdit = selectPreset(inactiveEdit, "baidu");
    inactiveEdit = updateActivePreset(inactiveEdit, { appId: "1", appSecret: "s" });
    inactiveEdit = selectPreset(inactiveEdit, "youdao");
    expect(providerConfigSignature(inactiveEdit)).toBe(providerConfigSignature(onYoudao));
  });
});
