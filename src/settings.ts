/**
 * Plugin settings — PURE (no obsidian). Holds the types, defaults, and the
 * merge/validation logic so it's unit-testable. The PluginSettingTab UI lives
 * in ui/settingsTab.ts (a shell file) and writes back into this shape.
 */
import { ProviderConfig } from "./translator/provider";

export type DisplayMode = "bilingual" | "translation-only";

/**
 * Which translation backend to talk to.
 *   - "openai": any OpenAI-compatible `/chat/completions` endpoint (DeepSeek /
 *     OpenAI / SiliconFlow / Ollama / any custom URL). `baseUrl` is the API
 *     origin, `model` picks the model.
 *   - "baidu": Baidu's general translate API (documented at fanyi-api.baidu.com).
 *     `baseUrl` carries the APP ID (repurposed), `apiKey` carries the secret;
 *     `model` is not used by the wire protocol at all — cache identity is
 *     derived from a stable constant via {@link cacheModel} so the field's
 *     content never invalidates cached translations.
 */
export type ProviderKind = "openai" | "baidu";

/**
 * Stable cache-identity for the Baidu general translate API. The actual model
 * name in settings is ignored for Baidu (there is no such wire field), so the
 * cache key must not depend on whatever text happens to be sitting in the
 * "Model" input — this constant takes its place.
 */
export const BAIDU_CACHE_MODEL = "baidu-general";

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
 * OpenAI-compatible service presets, plus the Baidu general translate API.
 * Picking one pre-fills baseUrl/model and — since each service rate-limits
 * differently — its recommended Advanced tuning (see {@link applyProviderPreset}).
 * Any OpenAI-compatible endpoint still works via the Custom option (which
 * never touches Advanced). The Baidu preset switches `providerKind` to
 * "baidu": the wire format differs entirely, and for that kind `baseUrl`
 * holds the APP ID and `apiKey` holds the secret (see ProviderKind).
 */
export interface ProviderPreset {
  id: string;
  label: string;
  /** Which wire protocol this preset selects. Defaults to "openai". */
  kind?: ProviderKind;
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
  {
    id: "baidu",
    label: "Baidu API",
    kind: "baidu",
    // For Baidu, `baseUrl` is repurposed to hold the APP ID (per user request:
    // "API key" -> secret, "Base URL" -> APP ID). Leave it empty in the preset
    // so switching in doesn't clobber a previously configured APP ID. The wire
    // endpoint is hard-coded inside the Baidu provider.
    baseUrl: "",
    // Baidu has no "model" concept; the field is displayed but ignored on the
    // wire. Blank in the preset so switching in doesn't stamp a misleading name.
    model: "",
    // Standard-tier Baidu is QPS=1 (higher tiers are 10 / 100). Keep the fleet
    // small and space starts by ~1.1s so the standard tier passes untuned;
    // small batches also keep per-segment line accounting reliable.
    advanced: { concurrency: 1, minIntervalMs: 1100, maxRetries: 3, batchCharBudget: 2000, maxSegmentsPerBatch: 8 },
  },
];

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Find the preset matching the current settings.
 *
 * Kind-first, then base URL:
 *   - `providerKind: "baidu"` is a hard signal — the base URL is a user-supplied
 *     APP ID, not a service origin, so we identify the preset by kind alone.
 *     Any preset carrying `kind: "baidu"` wins; falling back to the base-URL
 *     match would incorrectly land on Custom (or on a URL-shaped APP ID).
 *   - Otherwise we match an OpenAI-compatible preset by normalized base URL
 *     (trailing-slash / case insensitive; model may be customized freely).
 */
export function matchPreset(settings: InterlinearSettings): ProviderPreset | null {
  if (settings.providerKind === "baidu") {
    return PROVIDER_PRESETS.find((p) => p.kind === "baidu") ?? null;
  }
  const norm = normalizeBaseUrl(settings.baseUrl);
  return (
    PROVIDER_PRESETS.find((p) => (p.kind ?? "openai") === "openai" && normalizeBaseUrl(p.baseUrl) === norm) ??
    null
  );
}

/**
 * Settings produced by selecting a service preset: always sets baseUrl + model,
 * switches providerKind to the preset's kind ("openai" by default), and
 * overwrites the current values with the preset's recommended Advanced tuning
 * (only the fields it declares; the rest are kept). The result is run through
 * {@link normalizeSettings} so every value stays clamped/valid. Pure + testable
 * — the UI persists the returned object.
 */
export function applyProviderPreset(
  current: InterlinearSettings,
  preset: ProviderPreset
): InterlinearSettings {
  return normalizeSettings({
    ...current,
    providerKind: preset.kind ?? "openai",
    baseUrl: preset.baseUrl,
    model: preset.model,
    ...preset.advanced,
  });
}

export interface InterlinearSettings {
  /**
   * Which backend protocol to speak. Also decides how baseUrl/model are used —
   * see {@link ProviderKind}. Defaults to "openai" for backward compatibility
   * with settings saved before this field existed.
   */
  providerKind: ProviderKind;
  /** BYOK — stored only in local data.json; never logged, never committed. */
  apiKey: string;
  baseUrl: string;
  model: string;
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
  providerKind: "openai",
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
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
const PROVIDER_KINDS: ReadonlyArray<ProviderKind> = ["openai", "baidu"];

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

/**
 * Merge persisted data over defaults and clamp/validate every field, so a
 * corrupt or partial data.json can never produce an invalid runtime config.
 */
export function normalizeSettings(raw: unknown): InterlinearSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<InterlinearSettings>;
  const merged = { ...DEFAULT_SETTINGS, ...r };
  const providerKind = oneOf(merged.providerKind, PROVIDER_KINDS, DEFAULT_SETTINGS.providerKind);
  // For OpenAI-compatible endpoints, an empty baseUrl/model is meaningless, so
  // fall back to the DeepSeek defaults. For Baidu, `baseUrl` carries the APP ID
  // and `model` is unused — those defaults would be actively WRONG there, so
  // preserve whatever the user has entered (even if empty; isConfigured will
  // then simply gate translation until they fill it in).
  const baseUrl =
    providerKind === "baidu"
      ? typeof merged.baseUrl === "string" ? merged.baseUrl.trim() : ""
      : nonEmptyOr(merged.baseUrl, DEFAULT_SETTINGS.baseUrl);
  const model =
    providerKind === "baidu"
      ? typeof merged.model === "string" ? merged.model.trim() : ""
      : nonEmptyOr(merged.model, DEFAULT_SETTINGS.model);
  return {
    providerKind,
    apiKey: typeof merged.apiKey === "string" ? merged.apiKey : "",
    baseUrl,
    model,
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

/**
 * Cache-identity for the current settings. Substitutes a stable constant for
 * "model" on backends that don't have a model field (Baidu), so the cache key
 * never depends on whatever text is sitting in the ignored input. OpenAI-family
 * providers use the real model name so switching models still invalidates.
 */
export function cacheModel(s: InterlinearSettings): string {
  return s.providerKind === "baidu" ? BAIDU_CACHE_MODEL : s.model;
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
 * A translation can only run once BYOK credentials have been supplied. Baidu
 * additionally requires an APP ID (which we store in `baseUrl`), so both
 * fields must be non-empty for that kind.
 */
export function isConfigured(s: InterlinearSettings): boolean {
  if (s.apiKey.trim().length === 0) return false;
  if (s.providerKind === "baidu" && s.baseUrl.trim().length === 0) return false;
  return true;
}

/**
 * Signature of the translation-affecting config (the provider fields). A change
 * means prior failures may now succeed and the cache identity (model/targetLang)
 * may differ, so the controller drops its per-note "failed/skip" set when this
 * changes — whether edited in settings or synced in externally. Rate/batch knobs
 * (concurrency, retries, …) are intentionally excluded: they tune delivery, not
 * the request's success criteria or result identity. Includes providerKind
 * because switching backend semantics changes everything even if the surface
 * fields happen to match.
 */
export function providerConfigSignature(s: InterlinearSettings): string {
  return JSON.stringify({ kind: s.providerKind, ...toProviderConfig(s) });
}
