/**
 * Plugin settings — PURE (no obsidian). Holds the types, defaults, and the
 * merge/validation logic so it's unit-testable. The PluginSettingTab UI lives
 * in ui/settingsTab.ts (a shell file) and writes back into this shape.
 */
import { ProviderConfig } from "./translator/provider";

export type DisplayMode = "bilingual" | "translation-only";

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
}

export const DEFAULT_SETTINGS: InterlinearSettings = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  defaultDisplayMode: "bilingual",
  targetLang: "zh-CN",
  concurrency: 3,
  minIntervalMs: 300,
  maxRetries: 3,
  batchCharBudget: 4000,
};

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
  };
}

/** Project the provider-relevant subset for the translation backend. */
export function toProviderConfig(s: InterlinearSettings): ProviderConfig {
  return { apiKey: s.apiKey, baseUrl: s.baseUrl, model: s.model, targetLang: s.targetLang };
}

/** A translation can only run once an API key has been supplied (BYOK). */
export function isConfigured(s: InterlinearSettings): boolean {
  return s.apiKey.trim().length > 0;
}
