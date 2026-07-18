/**
 * Plugin settings — PURE (no obsidian). Holds the types, defaults, and the
 * merge/validation logic so it's unit-testable. The PluginSettingTab UI lives
 * in ui/settingsTab.ts (a shell file) and writes back into this shape.
 */
import { ProviderConfig } from "./translator/provider";
import { MtServiceId } from "./translator/langCodes";

export type DisplayMode = "bilingual" | "translation-only";

const FIRST_SETTINGS_SCHEMA_VERSION = 1;
export const SETTINGS_SCHEMA_VERSION = 2 as const;
export const SETTINGS_BACKUP_FILENAME = "data.backup.json";

export const LLM_PRESET_IDS = ["deepseek", "openai", "siliconflow", "ollama", "custom"] as const;
export type LlmPresetId = (typeof LLM_PRESET_IDS)[number];

/**
 * The active translation preset: OpenAI-compatible presets select the shared
 * chat path; the rest select traditional machine-translation providers.
 */
export type TranslationService = LlmPresetId | MtServiceId;
export type TranslationPresetId = TranslationService;

const TRANSLATION_SERVICES: ReadonlyArray<TranslationService> = [
  ...LLM_PRESET_IDS,
  "baidu",
  "youdao",
];

/** Where the in-view floating button (FAB) is shown. */
export type FabVisibility = "always" | "mobile" | "never";

/** Visual theme applied to injected translations (pure CSS class swap). */
export type TranslationStyle = "border" | "quote" | "muted" | "dashed" | "mask";

export const TRANSLATION_STYLES: ReadonlyArray<{ value: TranslationStyle; label: string }> = [
  { value: "border", label: "Border (default)" },
  { value: "quote", label: "Quote block" },
  { value: "muted", label: "Muted text" },
  { value: "dashed", label: "Dashed underline" },
  { value: "mask", label: "Learning mask (blur until hover)" },
];

export interface AdvancedSettings {
  /** Max concurrent translation requests. */
  concurrency: number;
  /** Minimum spacing between request starts (ms). */
  minIntervalMs: number;
  /** Retries after the initial attempt (429/transient). */
  maxRetries: number;
  /** Characters per packed batch request. */
  batchCharBudget: number;
  /** Max blocks packed into one request (also bounded by batchCharBudget). */
  maxSegmentsPerBatch: number;
}

/** The Advanced (rate/batch) knobs a preset can recommend for its service. */
export type ProviderPresetAdvanced = Partial<AdvancedSettings>;

/**
 * OpenAI-compatible service presets. On first selection each one pre-fills
 * baseUrl/model and its recommended Advanced tuning. Any endpoint speaking
 * `/chat/completions` still works via the Custom option.
 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  /**
   * Conservative starting points keyed to each service's rate-limiting MODEL,
   * not exact published quotas — users can raise them. A full set is declared
   * so first-time initialization is deterministic.
   */
  advanced?: ProviderPresetAdvanced;
}

export const PROVIDER_PRESETS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    // Limited by concurrent connections with a very high cap (not RPM/TPM), so
    // there's no point spacing requests and several can run in parallel.
    advanced: { concurrency: 10, minIntervalMs: 0, maxRetries: 3, batchCharBudget: 4000, maxSegmentsPerBatch: 12 },
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    // RPM/TPM tiered limits — low tiers 429 easily, so throttle starts and keep
    // a spare retry (the API returns Retry-After, which the pool honors).
    advanced: { concurrency: 4, minIntervalMs: 200, maxRetries: 4, batchCharBudget: 4000, maxSegmentsPerBatch: 12 },
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
    // Also RPM/TPM tiered; free/low tiers are stricter — same conservative shape.
    advanced: { concurrency: 4, minIntervalMs: 200, maxRetries: 4, batchCharBudget: 4000, maxSegmentsPerBatch: 12 },
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5",
    // No network limit but compute-bound with low default parallelism; a smaller
    // local model also miscounts <<<SEG k>>> markers more, so keep batches small.
    advanced: { concurrency: 2, minIntervalMs: 0, maxRetries: 2, batchCharBudget: 2000, maxSegmentsPerBatch: 6 },
  },
] as const satisfies ReadonlyArray<ProviderPreset>;

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Find the preset matching a base URL (model may be customized freely). */
export function matchPreset(baseUrl: string): (typeof PROVIDER_PRESETS)[number] | null {
  const norm = normalizeBaseUrl(baseUrl);
  const exact = PROVIDER_PRESETS.find((p) => normalizeBaseUrl(p.baseUrl) === norm);
  if (exact) return exact;

  try {
    const candidate = new URL(baseUrl.trim());
    return PROVIDER_PRESETS.find((p) => {
      const known = new URL(p.baseUrl);
      return candidate.protocol === known.protocol && candidate.host === known.host;
    }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Traditional machine-translation service presets. There is no baseUrl/model
 * to pre-fill because each endpoint is fixed in its provider, but the common
 * free tiers are hard-limited (some to ~1 request/second), so their recommended
 * rate/batch tuning is used when the record is first created.
 */
export interface MtServicePreset {
  id: MtServiceId;
  label: string;
  advanced: Required<ProviderPresetAdvanced>;
}

export const MT_SERVICE_PRESETS: ReadonlyArray<MtServicePreset> = [
  {
    id: "baidu",
    label: "Baidu Translate (百度翻译)",
    // The personally-verified (个人认证) Advanced plan is free at 10 QPS
    // (1M chars/month), and the API is one-text-per-request (its newline
    // batching breaks on segments containing newlines): one segment per
    // request, ~150 ms start spacing keeps a safety margin under the quota.
    // Unverified accounts are limited to ~1 QPS — raise Min interval to
    // ~1100 ms (see the settings-tab hint).
    advanced: { concurrency: 2, minIntervalMs: 150, maxRetries: 3, batchCharBudget: 1800, maxSegmentsPerBatch: 1 },
  },
  {
    id: "youdao",
    label: "Youdao (有道智云)",
    // The docs publish no QPS number, but the console assigns each app a QPS
    // quota that is low in practice (~3 QPS pacing produced 411 batch
    // failures on a default app): strictly serial, ≥1.1 s spacing, one q per
    // request. Users with a higher app quota can lower Min interval.
    advanced: { concurrency: 1, minIntervalMs: 1100, maxRetries: 3, batchCharBudget: 4000, maxSegmentsPerBatch: 1 },
  },
];

export interface LlmPresetSettings extends AdvancedSettings {
  /** BYOK — stored only in local plugin settings files; never logged or committed. */
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Optional extra instructions appended to the system prompt (glossary, tone, domain). */
  customInstructions: string;
}

export type LlmEndpointField = "baseUrl" | "model";

export interface BaiduPresetSettings extends AdvancedSettings {
  /** Traditional MT credentials (BYOK, same storage rules as apiKey). */
  appId: string;
  appSecret: string;
}

export interface YoudaoPresetSettings extends AdvancedSettings {
  appKey: string;
  appSecret: string;
}

export type ActivePresetSettings =
  | LlmPresetSettings
  | BaiduPresetSettings
  | YoudaoPresetSettings;

export interface PresetRecords {
  /** Sparse by design: a record appears after migration or first selection. */
  llm: Partial<Record<LlmPresetId, LlmPresetSettings>>;
  mt: {
    baidu?: BaiduPresetSettings;
    youdao?: YoudaoPresetSettings;
  };
}

export interface InterlinearSettings {
  settingsSchemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  /** Active translation preset. Each preset's fields persist independently. */
  service: TranslationPresetId;
  defaultDisplayMode: DisplayMode;
  targetLang: string;
  /** Where the in-view floating button is shown (mobile has no status bar). */
  showFab: FabVisibility;
  /** Visual theme for injected translations. */
  translationStyle: TranslationStyle;
  /** Persist the translation cache to disk (plugin folder, never the notes). */
  persistCache: boolean;
  presets: PresetRecords;
}

const DEFAULT_ADVANCED: AdvancedSettings = {
  // DeepSeek rate-limits by concurrent connections (flash allows ~2500), NOT by
  // RPM/TPM — so there's no point spacing requests (minIntervalMs: 0) and plenty
  // of room to run several in parallel. Batch budget stays moderate to keep the
  // per-segment marker contract reliable (large batches => more miscounts).
  concurrency: 10,
  minIntervalMs: 0,
  maxRetries: 3,
  batchCharBudget: 4000,
  // Independently of the char budget, cap segments per request: a doc of many
  // short blocks could otherwise pack dozens of <<<SEG k>>> markers into one
  // request, where the model is likelier to miscount and force the slow
  // per-segment fallback. 12 stays reliable without fragmenting normal prose.
  maxSegmentsPerBatch: 12,
};

export const DEFAULT_SETTINGS: InterlinearSettings = {
  settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  service: "deepseek",
  defaultDisplayMode: "bilingual",
  targetLang: "zh-CN",
  // Mobile has no status bar, so the FAB is the entry point there; desktop
  // defaults to the status-bar buttons (FAB opt-in via "always").
  showFab: "mobile",
  translationStyle: "border",
  persistCache: true,
  presets: {
    llm: { deepseek: createDefaultLlmPreset("deepseek") },
    mt: {},
  },
};

const FAB_VISIBILITIES: ReadonlyArray<FabVisibility> = ["always", "mobile", "never"];
const TRANSLATION_STYLE_VALUES: ReadonlyArray<TranslationStyle> = [
  "border",
  "quote",
  "muted",
  "dashed",
  "mask",
];
const MT_PRESET_IDS: ReadonlyArray<MtServiceId> = ["baidu", "youdao"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function oneOf<T extends string>(value: unknown, allowed: ReadonlyArray<T>, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function nonEmptyOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** String field of a possibly-partial/garbage nested object ("" otherwise). */
function strField(obj: unknown, key: string): string {
  if (obj && typeof obj === "object") {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return "";
}

function trimmedField(obj: Record<string, unknown>, key: string): string {
  return strField(obj, key).trim();
}

function normalizeAdvanced(raw: Record<string, unknown>, defaults: AdvancedSettings): AdvancedSettings {
  return {
    concurrency: clampInt(raw.concurrency, 1, 16, defaults.concurrency),
    minIntervalMs: clampInt(raw.minIntervalMs, 0, 60000, defaults.minIntervalMs),
    maxRetries: clampInt(raw.maxRetries, 0, 10, defaults.maxRetries),
    batchCharBudget: clampInt(raw.batchCharBudget, 200, 100000, defaults.batchCharBudget),
    maxSegmentsPerBatch: clampInt(
      raw.maxSegmentsPerBatch,
      1,
      100,
      defaults.maxSegmentsPerBatch
    ),
  };
}

function knownLlmPreset(id: LlmPresetId): (typeof PROVIDER_PRESETS)[number] | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

export function isLlmPresetId(value: unknown): value is LlmPresetId {
  return LLM_PRESET_IDS.includes(value as LlmPresetId);
}

export function isMtPresetId(value: unknown): value is MtServiceId {
  return MT_PRESET_IDS.includes(value as MtServiceId);
}

export function createDefaultLlmPreset(id: LlmPresetId): LlmPresetSettings {
  const preset = knownLlmPreset(id);
  return {
    apiKey: "",
    baseUrl: preset?.baseUrl ?? "",
    model: preset?.model ?? "",
    customInstructions: "",
    ...DEFAULT_ADVANCED,
    ...preset?.advanced,
  };
}

/**
 * Normalize an editable LLM endpoint field when its input loses focus. Known
 * presets restore their shipped endpoint/model when left empty; Custom stays
 * empty so the user can configure it later.
 */
export function normalizeLlmEndpointFieldOnBlur(
  id: LlmPresetId,
  field: LlmEndpointField,
  value: string
): string {
  const trimmed = value.trim();
  if (trimmed.length > 0 || id === "custom") return trimmed;
  return createDefaultLlmPreset(id)[field];
}

export function createDefaultBaiduPreset(): BaiduPresetSettings {
  const preset = MT_SERVICE_PRESETS.find((item) => item.id === "baidu");
  return { appId: "", appSecret: "", ...(preset?.advanced ?? DEFAULT_ADVANCED) };
}

export function createDefaultYoudaoPreset(): YoudaoPresetSettings {
  const preset = MT_SERVICE_PRESETS.find((item) => item.id === "youdao");
  return { appKey: "", appSecret: "", ...(preset?.advanced ?? DEFAULT_ADVANCED) };
}

function normalizeLlmPreset(id: LlmPresetId, raw: unknown): LlmPresetSettings {
  const defaults = createDefaultLlmPreset(id);
  const record = isRecord(raw) ? raw : {};
  const allowEmptyEndpoint = id === "custom";
  return {
    apiKey: strField(record, "apiKey"),
    baseUrl: allowEmptyEndpoint
      ? trimmedField(record, "baseUrl")
      : nonEmptyOr(record.baseUrl, defaults.baseUrl),
    model: allowEmptyEndpoint
      ? trimmedField(record, "model")
      : nonEmptyOr(record.model, defaults.model),
    customInstructions: trimmedField(record, "customInstructions"),
    ...normalizeAdvanced(record, defaults),
  };
}

function normalizeBaiduPreset(raw: unknown): BaiduPresetSettings {
  const defaults = createDefaultBaiduPreset();
  const record = isRecord(raw) ? raw : {};
  return {
    appId: strField(record, "appId"),
    appSecret: strField(record, "appSecret"),
    ...normalizeAdvanced(record, defaults),
  };
}

function normalizeYoudaoPreset(raw: unknown): YoudaoPresetSettings {
  const defaults = createDefaultYoudaoPreset();
  const record = isRecord(raw) ? raw : {};
  return {
    appKey: strField(record, "appKey"),
    appSecret: strField(record, "appSecret"),
    ...normalizeAdvanced(record, defaults),
  };
}

function normalizePresetRecords(raw: unknown): PresetRecords {
  const records = isRecord(raw) ? raw : {};
  const llmRaw = isRecord(records.llm) ? records.llm : {};
  const mtRaw = isRecord(records.mt) ? records.mt : {};
  const llm: Partial<Record<LlmPresetId, LlmPresetSettings>> = {};

  for (const id of LLM_PRESET_IDS) {
    if (hasOwn(llmRaw, id)) llm[id] = normalizeLlmPreset(id, llmRaw[id]);
  }

  const mt: PresetRecords["mt"] = {};
  if (hasOwn(mtRaw, "baidu")) mt.baidu = normalizeBaiduPreset(mtRaw.baidu);
  if (hasOwn(mtRaw, "youdao")) mt.youdao = normalizeYoudaoPreset(mtRaw.youdao);
  return { llm, mt };
}

function ensureActivePreset(settings: InterlinearSettings): void {
  if (isLlmPresetId(settings.service)) {
    settings.presets.llm[settings.service] ??= createDefaultLlmPreset(settings.service);
  } else if (settings.service === "baidu") {
    settings.presets.mt.baidu ??= createDefaultBaiduPreset();
  } else {
    settings.presets.mt.youdao ??= createDefaultYoudaoPreset();
  }
}

/**
 * Merge persisted data over defaults and clamp/validate every field, so a
 * corrupt or partial data.json can never produce an invalid runtime config.
 */
export function normalizeSettings(raw: unknown): InterlinearSettings {
  const version = settingsSchemaVersion(raw);
  if (version === null || version === SETTINGS_SCHEMA_VERSION) {
    return normalizeNewSettings(raw);
  }
  return migrateSettings(raw, version);
}

function normalizeNewSettings(raw: unknown): InterlinearSettings {
  const record = isRecord(raw) ? raw : {};
  const settings: InterlinearSettings = {
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    service: oneOf(record.service, TRANSLATION_SERVICES, DEFAULT_SETTINGS.service),
    defaultDisplayMode:
      record.defaultDisplayMode === "translation-only" ? "translation-only" : "bilingual",
    targetLang: nonEmptyOr(record.targetLang, DEFAULT_SETTINGS.targetLang),
    showFab: oneOf(record.showFab, FAB_VISIBILITIES, DEFAULT_SETTINGS.showFab),
    translationStyle: oneOf(
      record.translationStyle,
      TRANSLATION_STYLE_VALUES,
      DEFAULT_SETTINGS.translationStyle
    ),
    persistCache: typeof record.persistCache === "boolean" ? record.persistCache : true,
    presets: normalizePresetRecords(record.presets),
  };
  ensureActivePreset(settings);
  return settings;
}

export class UnsupportedSettingsSchemaVersionError extends Error {
  constructor(version: unknown) {
    const message =
      typeof version === "number" &&
      Number.isSafeInteger(version) &&
      version > SETTINGS_SCHEMA_VERSION
        ? `Interlinear settings schema version ${version} is newer than supported version ${SETTINGS_SCHEMA_VERSION}`
        : `Interlinear settings schema version must be an integer <= ${SETTINGS_SCHEMA_VERSION}`;
    super(message);
    this.name = "UnsupportedSettingsSchemaVersionError";
  }
}

function settingsSchemaVersion(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw) || !hasOwn(raw, "settingsSchemaVersion")) {
    return FIRST_SETTINGS_SCHEMA_VERSION;
  }

  const version = raw.settingsSchemaVersion;
  if (
    typeof version === "number" &&
    Number.isSafeInteger(version) &&
    version >= FIRST_SETTINGS_SCHEMA_VERSION &&
    version <= SETTINGS_SCHEMA_VERSION
  ) {
    return version;
  }
  throw new UnsupportedSettingsSchemaVersionError(version);
}

/** Any supported schema older than the current one requires migration. */
export function isLegacySettingsData(raw: unknown): boolean {
  const version = settingsSchemaVersion(raw);
  return version !== null && version < SETTINGS_SCHEMA_VERSION;
}

function hasAnyCredential(raw: unknown, keys: ReadonlyArray<string>): boolean {
  if (!isRecord(raw)) return false;
  return keys.some((key) => strField(raw, key).trim().length > 0);
}

function legacyAdvanced(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    concurrency: raw.concurrency,
    minIntervalMs: raw.minIntervalMs,
    maxRetries: raw.maxRetries,
    batchCharBudget: raw.batchCharBudget,
    maxSegmentsPerBatch: raw.maxSegmentsPerBatch,
  };
}

/**
 * Convert one old flat data.json into the nested preset schema. The active LLM
 * preset is inferred from its normalized URL; an unknown endpoint becomes
 * `custom`. Inactive MT records are retained only when they contain credentials.
 */
export function migrateLegacySettings(raw: unknown): InterlinearSettings {
  const record = isRecord(raw) ? raw : {};
  const legacyService = oneOf(
    record.service,
    ["llm", "baidu", "youdao"] as const,
    "llm"
  );
  const deepseekDefaults = createDefaultLlmPreset("deepseek");
  const legacyBaseUrl = nonEmptyOr(record.baseUrl, deepseekDefaults.baseUrl);
  const llmId: LlmPresetId = matchPreset(legacyBaseUrl)?.id ?? "custom";
  const activeAdvanced = legacyAdvanced(record);

  const llmRaw: Record<string, unknown> = {
    apiKey: strField(record, "apiKey"),
    baseUrl: legacyBaseUrl,
    model: nonEmptyOr(record.model, deepseekDefaults.model),
    customInstructions: strField(record, "customInstructions"),
    ...(legacyService === "llm" ? activeAdvanced : {}),
  };
  const llm: Partial<Record<LlmPresetId, LlmPresetSettings>> = {
    [llmId]: normalizeLlmPreset(llmId, llmRaw),
  };
  const mt: PresetRecords["mt"] = {};

  if (legacyService === "baidu" || hasAnyCredential(record.baidu, ["appId", "appSecret"])) {
    const credentials = isRecord(record.baidu) ? record.baidu : {};
    mt.baidu = normalizeBaiduPreset({
      ...credentials,
      ...(legacyService === "baidu" ? activeAdvanced : {}),
    });
  }
  if (legacyService === "youdao" || hasAnyCredential(record.youdao, ["appKey", "appSecret"])) {
    const credentials = isRecord(record.youdao) ? record.youdao : {};
    mt.youdao = normalizeYoudaoPreset({
      ...credentials,
      ...(legacyService === "youdao" ? activeAdvanced : {}),
    });
  }

  const service: TranslationPresetId =
    legacyService === "llm" ? llmId : legacyService;
  return normalizeNewSettings({
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    service,
    defaultDisplayMode: record.defaultDisplayMode,
    targetLang: record.targetLang,
    showFab: record.showFab,
    translationStyle: record.translationStyle,
    persistCache: record.persistCache,
    presets: { llm, mt },
  });
}

function migrateSettings(raw: unknown, fromVersion: number): InterlinearSettings {
  if (fromVersion === 1) {
    return migrateLegacySettings(raw);
  } else {
    throw new Error(
      `Interlinear: no settings migration registered for schema version ${fromVersion}`
    );
  }
}

export interface SettingsMigrationIo {
  readBackup(): Promise<string | null>;
  writeBackup(data: string): Promise<void>;
  writeSettings(settings: InterlinearSettings): Promise<void>;
}

export function backupMatchesSchemaVersion(data: string | null, version: number): boolean {
  if (data === null) return false;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed)) return false;
    const storedVersion = hasOwn(parsed, "settingsSchemaVersion")
      ? parsed.settingsSchemaVersion
      : FIRST_SETTINGS_SCHEMA_VERSION;
    return (
      typeof storedVersion === "number" &&
      Number.isSafeInteger(storedVersion) &&
      storedVersion >= FIRST_SETTINGS_SCHEMA_VERSION &&
      storedVersion === version
    );
  } catch {
    return false;
  }
}

/** Load settings, backing up the source schema before its migration write. */
export async function loadStoredSettings(
  raw: unknown,
  io: SettingsMigrationIo
): Promise<InterlinearSettings> {
  const version = settingsSchemaVersion(raw);
  if (version === null || version === SETTINGS_SCHEMA_VERSION) {
    return normalizeNewSettings(raw);
  }

  if (version === 1) {
    // Keep the complete migration transaction version-scoped: a future schema
    // gets its own branch, backup rules, migration, and persistence sequence.
    try {
      const backup = await io.readBackup();
      if (!backupMatchesSchemaVersion(backup, version)) {
        await io.writeBackup(JSON.stringify(raw, null, 2));
      }
    } catch {
      throw new Error("Interlinear: failed to prepare the settings backup; migration aborted");
    }

    const settings = migrateLegacySettings(raw);
    await io.writeSettings(settings);
    return settings;
  } else {
    throw new Error(
      `Interlinear: no settings migration registered for schema version ${version}`
    );
  }
}

/**
 * Select a concrete preset. An existing record retains its normalized values;
 * a missing record is created from that preset's defaults.
 */
export function selectPreset(
  current: InterlinearSettings,
  service: TranslationPresetId
): InterlinearSettings {
  const next = normalizeSettings(current);
  next.service = service;
  ensureActivePreset(next);
  return next;
}

export type ActivePresetPatch = Partial<
  LlmPresetSettings & BaiduPresetSettings & YoudaoPresetSettings
>;

/** Update only the selected preset record, leaving every other record untouched. */
export function updateActivePreset(
  current: InterlinearSettings,
  patch: ActivePresetPatch
): InterlinearSettings {
  const next = normalizeSettings(current);
  if (isLlmPresetId(next.service)) {
    next.presets.llm[next.service] = normalizeLlmPreset(next.service, {
      ...next.presets.llm[next.service],
      ...patch,
    });
  } else if (next.service === "baidu") {
    next.presets.mt.baidu = normalizeBaiduPreset({ ...next.presets.mt.baidu, ...patch });
  } else {
    next.presets.mt.youdao = normalizeYoudaoPreset({ ...next.presets.mt.youdao, ...patch });
  }
  return next;
}

/** Return the active record. Normalized settings always have this record. */
export function getActivePresetSettings(settings: InterlinearSettings): ActivePresetSettings {
  if (isLlmPresetId(settings.service)) {
    return settings.presets.llm[settings.service] ?? createDefaultLlmPreset(settings.service);
  }
  if (settings.service === "baidu") {
    return settings.presets.mt.baidu ?? createDefaultBaiduPreset();
  }
  return settings.presets.mt.youdao ?? createDefaultYoudaoPreset();
}

export function getActiveLlmSettings(settings: InterlinearSettings): LlmPresetSettings | null {
  if (!isLlmPresetId(settings.service)) return null;
  return settings.presets.llm[settings.service] ?? createDefaultLlmPreset(settings.service);
}

/** Project the provider-relevant subset for the translation backend. */
export function toProviderConfig(s: InterlinearSettings): ProviderConfig {
  const preset = getActiveLlmSettings(s);
  if (!preset) throw new Error("The active preset is not an LLM provider");
  return {
    apiKey: preset.apiKey,
    baseUrl: preset.baseUrl,
    model: preset.model,
    targetLang: s.targetLang,
    customInstructions: preset.customInstructions,
  };
}

/**
 * True when the base URL would send the API key over plaintext HTTP to a
 * NON-local host. Local http is legitimate (Ollama et al.); remote http means
 * the Bearer key crosses the network unencrypted, so the settings UI warns.
 */
export function isInsecureBaseUrl(baseUrl: string): boolean {
  const m = /^http:\/\/(\[[^\]]*\]|[^/:?#]+)/i.exec(baseUrl.trim());
  if (!m) return false; // https, empty, or unparsable — nothing to warn about
  const host = m[1].toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]";
}

/** A translation can only run once the ACTIVE service's credentials exist (BYOK). */
export function isConfigured(s: InterlinearSettings): boolean {
  switch (s.service) {
    case "baidu":
      return Boolean(s.presets.mt.baidu?.appId.trim() && s.presets.mt.baidu.appSecret.trim());
    case "youdao":
      return Boolean(s.presets.mt.youdao?.appKey.trim() && s.presets.mt.youdao.appSecret.trim());
    default: {
      const preset = getActiveLlmSettings(s);
      return Boolean(preset?.apiKey.trim() && preset.baseUrl.trim() && preset.model.trim());
    }
  }
}

/**
 * Cache identity of the active backend — the "model" slot of the cache key.
 * LLM keeps the bare model name (existing users' cache entries stay valid);
 * MT services use a `mt:`-prefixed service id so they can never collide with
 * a model literally named after a service.
 */
export function cacheIdentity(s: InterlinearSettings): string {
  const llm = getActiveLlmSettings(s);
  return llm ? llm.model : `mt:${s.service}`;
}

/** The active service's translation-affecting config (credentials + language). */
function activeServiceConfig(s: InterlinearSettings): unknown {
  switch (s.service) {
    case "baidu": {
      const { appId, appSecret } = s.presets.mt.baidu!;
      return { appId, appSecret, targetLang: s.targetLang };
    }
    case "youdao": {
      const { appKey, appSecret } = s.presets.mt.youdao!;
      return { appKey, appSecret, targetLang: s.targetLang };
    }
    default:
      return toProviderConfig(s);
  }
}

/**
 * Signature of the translation-affecting config for the ACTIVE service. A
 * change means prior failures may now succeed and the cache identity may
 * differ, so the controller drops its per-note "failed/skip" set when this
 * changes — whether edited in settings or synced in externally. Rate/batch
 * knobs (concurrency, retries, …) are intentionally excluded: they tune
 * delivery, not the request's success criteria or result identity. Editing an
 * INACTIVE service's credentials doesn't change the signature either — those
 * fields can't affect the next request.
 */
export function providerConfigSignature(s: InterlinearSettings): string {
  return JSON.stringify([s.service, activeServiceConfig(s)]);
}
