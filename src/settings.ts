/**
 * Plugin settings — PURE (no obsidian). Holds the types, defaults, and the
 * merge/validation logic so it's unit-testable. The PluginSettingTab UI lives
 * in ui/settingsTab.ts (a shell file) and writes back into this shape.
 */
import { ProviderConfig } from "./translator/provider";
import { MtServiceId } from "./translator/langCodes";

export type DisplayMode = "bilingual" | "translation-only";

/**
 * The active translation backend: "llm" = the OpenAI-compatible chat path
 * (DeepSeek and friends, selected further by baseUrl/model as before); the
 * rest are traditional machine-translation APIs with their own credentials.
 */
export type TranslationService = "llm" | MtServiceId;

const TRANSLATION_SERVICES: ReadonlyArray<TranslationService> = [
  "llm",
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

/** The Advanced (rate/batch) knobs a preset can recommend for its service. */
export type ProviderPresetAdvanced = Partial<
  Pick<
    InterlinearSettings,
    "concurrency" | "minIntervalMs" | "maxRetries" | "batchCharBudget" | "maxSegmentsPerBatch"
  >
>;

/**
 * OpenAI-compatible service presets. Picking one pre-fills baseUrl/model and —
 * since each service rate-limits differently — its recommended Advanced tuning
 * (see {@link applyProviderPreset}). Any endpoint speaking `/chat/completions`
 * still works via the Custom option (which never touches Advanced).
 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  /**
   * Recommended Advanced tuning, applied (overwriting the current values) when
   * this preset is selected. Conservative starting points keyed to each
   * service's rate-limiting MODEL, not exact published quotas — users can raise
   * them. A full set is declared so switching is deterministic regardless of
   * the previously selected preset.
   */
  advanced?: ProviderPresetAdvanced;
}

export const PROVIDER_PRESETS: ReadonlyArray<ProviderPreset> = [
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
];

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Find the preset matching a base URL (model may be customized freely). */
export function matchPreset(baseUrl: string): ProviderPreset | null {
  const norm = normalizeBaseUrl(baseUrl);
  return PROVIDER_PRESETS.find((p) => normalizeBaseUrl(p.baseUrl) === norm) ?? null;
}

/**
 * Settings produced by selecting a service preset: always sets baseUrl + model,
 * and overwrites the current values with the preset's recommended Advanced
 * tuning (only the fields it declares; the rest are kept). The result is run
 * through {@link normalizeSettings} so every value stays clamped/valid. Pure +
 * testable — the UI persists the returned object.
 */
export function applyProviderPreset(
  current: InterlinearSettings,
  preset: ProviderPreset
): InterlinearSettings {
  return normalizeSettings({
    ...current,
    service: "llm",
    baseUrl: preset.baseUrl,
    model: preset.model,
    ...preset.advanced,
  });
}

/**
 * Traditional machine-translation service presets. Unlike the LLM presets
 * there is no baseUrl/model to pre-fill — each service's endpoint is fixed in
 * its provider — but the recommended rate/batch tuning matters even more:
 * the common free tiers are hard-limited (some to ~1 request/second), so
 * switching applies a full Advanced block, exactly like the LLM presets.
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

/**
 * Settings produced by selecting an MT service: switches `service` and applies
 * the service's recommended Advanced tuning. Deliberately does NOT touch the
 * LLM fields (baseUrl/model/apiKey) or any other service's credentials, so
 * switching back and forth never loses configuration.
 */
export function applyMtServicePreset(
  current: InterlinearSettings,
  preset: MtServicePreset
): InterlinearSettings {
  return normalizeSettings({
    ...current,
    service: preset.id,
    ...preset.advanced,
  });
}

export interface InterlinearSettings {
  /** Active translation backend. All credentials below persist independently,
   *  so switching services never loses previously entered keys. */
  service: TranslationService;
  /** BYOK — stored only in local data.json; never logged, never committed. */
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Traditional MT credentials (BYOK, same storage rules as apiKey). */
  baidu: { appId: string; appSecret: string };
  youdao: { appKey: string; appSecret: string };
  defaultDisplayMode: DisplayMode;
  targetLang: string;
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
  /** Optional extra instructions appended to the system prompt (glossary, tone, domain). */
  customInstructions: string;
  /** Where the in-view floating button is shown (mobile has no status bar). */
  showFab: FabVisibility;
  /** Visual theme for injected translations. */
  translationStyle: TranslationStyle;
  /** Persist the translation cache to disk (plugin folder, never the notes). */
  persistCache: boolean;
}

export const DEFAULT_SETTINGS: InterlinearSettings = {
  service: "llm",
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  baidu: { appId: "", appSecret: "" },
  youdao: { appKey: "", appSecret: "" },
  defaultDisplayMode: "bilingual",
  targetLang: "zh-CN",
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
  customInstructions: "",
  // Mobile has no status bar, so the FAB is the entry point there; desktop
  // defaults to the status-bar buttons (FAB opt-in via "always").
  showFab: "mobile",
  translationStyle: "border",
  persistCache: true,
};

const FAB_VISIBILITIES: ReadonlyArray<FabVisibility> = ["always", "mobile", "never"];
const TRANSLATION_STYLE_VALUES: ReadonlyArray<TranslationStyle> = [
  "border",
  "quote",
  "muted",
  "dashed",
  "mask",
];

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

/**
 * Merge persisted data over defaults and clamp/validate every field, so a
 * corrupt or partial data.json can never produce an invalid runtime config.
 */
export function normalizeSettings(raw: unknown): InterlinearSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<InterlinearSettings>;
  const merged = { ...DEFAULT_SETTINGS, ...r };
  return {
    service: oneOf(merged.service, TRANSLATION_SERVICES, DEFAULT_SETTINGS.service),
    apiKey: typeof merged.apiKey === "string" ? merged.apiKey : "",
    baseUrl: nonEmptyOr(merged.baseUrl, DEFAULT_SETTINGS.baseUrl),
    model: nonEmptyOr(merged.model, DEFAULT_SETTINGS.model),
    // The top-level spread is shallow — normalize each credential sub-object
    // field-by-field so a partial/corrupt data.json can't leak bad shapes in.
    baidu: { appId: strField(merged.baidu, "appId"), appSecret: strField(merged.baidu, "appSecret") },
    youdao: { appKey: strField(merged.youdao, "appKey"), appSecret: strField(merged.youdao, "appSecret") },
    defaultDisplayMode:
      merged.defaultDisplayMode === "translation-only" ? "translation-only" : "bilingual",
    targetLang: nonEmptyOr(merged.targetLang, DEFAULT_SETTINGS.targetLang),
    concurrency: clampInt(merged.concurrency, 1, 16, DEFAULT_SETTINGS.concurrency),
    minIntervalMs: clampInt(merged.minIntervalMs, 0, 60000, DEFAULT_SETTINGS.minIntervalMs),
    maxRetries: clampInt(merged.maxRetries, 0, 10, DEFAULT_SETTINGS.maxRetries),
    batchCharBudget: clampInt(merged.batchCharBudget, 200, 100000, DEFAULT_SETTINGS.batchCharBudget),
    maxSegmentsPerBatch: clampInt(merged.maxSegmentsPerBatch, 1, 100, DEFAULT_SETTINGS.maxSegmentsPerBatch),
    customInstructions:
      typeof merged.customInstructions === "string" ? merged.customInstructions.trim() : "",
    showFab: oneOf(merged.showFab, FAB_VISIBILITIES, DEFAULT_SETTINGS.showFab),
    translationStyle: oneOf(
      merged.translationStyle,
      TRANSLATION_STYLE_VALUES,
      DEFAULT_SETTINGS.translationStyle
    ),
    persistCache: typeof merged.persistCache === "boolean" ? merged.persistCache : true,
  };
}

/** Project the provider-relevant subset for the translation backend. */
export function toProviderConfig(s: InterlinearSettings): ProviderConfig {
  return {
    apiKey: s.apiKey,
    baseUrl: s.baseUrl,
    model: s.model,
    targetLang: s.targetLang,
    customInstructions: s.customInstructions,
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
      return s.baidu.appId.trim().length > 0 && s.baidu.appSecret.trim().length > 0;
    case "youdao":
      return s.youdao.appKey.trim().length > 0 && s.youdao.appSecret.trim().length > 0;
    default:
      return s.apiKey.trim().length > 0;
  }
}

/**
 * Cache identity of the active backend — the "model" slot of the cache key.
 * LLM keeps the bare model name (existing users' cache entries stay valid);
 * MT services use a `mt:`-prefixed service id so they can never collide with
 * a model literally named after a service.
 */
export function cacheIdentity(s: InterlinearSettings): string {
  return s.service === "llm" ? s.model : `mt:${s.service}`;
}

/** The active service's translation-affecting config (credentials + language). */
function activeServiceConfig(s: InterlinearSettings): unknown {
  switch (s.service) {
    case "baidu":
      return { ...s.baidu, targetLang: s.targetLang };
    case "youdao":
      return { ...s.youdao, targetLang: s.targetLang };
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
