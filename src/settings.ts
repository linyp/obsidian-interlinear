/**
 * Plugin settings — PURE (no obsidian). Holds the types, defaults, and the
 * merge/validation logic so it's unit-testable. The PluginSettingTab UI lives
 * in ui/settingsTab.ts (a shell file) and writes back into this shape.
 */
import { ProviderConfig } from "./translator/provider";

export type DisplayMode = "bilingual" | "translation-only";

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

/**
 * OpenAI-compatible service presets. Picking one only pre-fills baseUrl/model —
 * any endpoint speaking `/chat/completions` works via the Custom option.
 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

export const PROVIDER_PRESETS: ReadonlyArray<ProviderPreset> = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "siliconflow", label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "qwen2.5" },
];

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Find the preset matching a base URL (model may be customized freely). */
export function matchPreset(baseUrl: string): ProviderPreset | null {
  const norm = normalizeBaseUrl(baseUrl);
  return PROVIDER_PRESETS.find((p) => normalizeBaseUrl(p.baseUrl) === norm) ?? null;
}

export interface InterlinearSettings {
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
  showFab: "always",
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

/**
 * Merge persisted data over defaults and clamp/validate every field, so a
 * corrupt or partial data.json can never produce an invalid runtime config.
 */
export function normalizeSettings(raw: unknown): InterlinearSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<InterlinearSettings>;
  const merged = { ...DEFAULT_SETTINGS, ...r };
  return {
    apiKey: typeof merged.apiKey === "string" ? merged.apiKey : "",
    baseUrl: nonEmptyOr(merged.baseUrl, DEFAULT_SETTINGS.baseUrl),
    model: nonEmptyOr(merged.model, DEFAULT_SETTINGS.model),
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

/** A translation can only run once an API key has been supplied (BYOK). */
export function isConfigured(s: InterlinearSettings): boolean {
  return s.apiKey.trim().length > 0;
}
