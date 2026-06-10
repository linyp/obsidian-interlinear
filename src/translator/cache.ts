/**
 * Content-hash translation cache with LRU eviction and JSON (de)serialization,
 * so it can persist across sessions in the plugin folder. PURE — no `obsidian`,
 * no filesystem; the disk wiring lives in main.ts.
 *
 * Privacy: keys are hashes of (model, targetLang, source text), so the
 * serialized form contains translations but never the source text itself.
 *
 * The key folds in model + target language so changing either never returns a
 * stale translation for the same source text.
 */
import { hashContent } from "../core/hash";

/**
 * Content-hash cache key, invalidated by model/targetLang changes.
 * The fields are JSON-encoded into a tuple so boundaries are unambiguous and
 * no separator character can ever cause a collision.
 */
export function cacheKey(text: string, model: string, targetLang: string): string {
  return hashContent(JSON.stringify([model, targetLang, text]));
}

export interface TranslationCacheOptions {
  /** Max stored entries; the least-recently-used are evicted first. */
  maxEntries?: number;
  /** Approximate max size (UTF-16 code units of keys + values). */
  maxChars?: number;
}

export const DEFAULT_MAX_ENTRIES = 20000;
export const DEFAULT_MAX_CHARS = 4_000_000; // ~8 MB of UTF-16, well under any IPC limit

const SERIAL_VERSION = 1;

interface SerialForm {
  v: number;
  e: Array<[string, string]>;
}

export class TranslationCache {
  /** Insertion order == recency order (oldest first); `get` re-inserts. */
  private readonly store = new Map<string, string>();
  private readonly maxEntries: number;
  private readonly maxChars: number;
  private chars = 0;

  /** Invoked after any mutation (set/clear/hydrate) — used to schedule a flush. */
  onDirty: (() => void) | null = null;

  constructor(opts: TranslationCacheOptions = {}) {
    this.maxEntries = Math.max(1, opts.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.maxChars = Math.max(1, opts.maxChars ?? DEFAULT_MAX_CHARS);
  }

  has(text: string, model: string, targetLang: string): boolean {
    return this.store.has(cacheKey(text, model, targetLang));
  }

  get(text: string, model: string, targetLang: string): string | undefined {
    const key = cacheKey(text, model, targetLang);
    const value = this.store.get(key);
    if (value !== undefined) {
      // LRU touch: move to the most-recent end. Recency is not persisted state,
      // so this does NOT mark the cache dirty.
      this.store.delete(key);
      this.store.set(key, value);
    }
    return value;
  }

  set(text: string, model: string, targetLang: string, translation: string): void {
    this.insert(cacheKey(text, model, targetLang), translation);
    this.onDirty?.();
  }

  get size(): number {
    return this.store.size;
  }

  /** Approximate stored size in UTF-16 code units (keys + values). */
  get charSize(): number {
    return this.chars;
  }

  clear(): void {
    if (this.store.size === 0) return;
    this.store.clear();
    this.chars = 0;
    this.onDirty?.();
  }

  /** Serialize to JSON, oldest entry first so hydration preserves LRU order. */
  serialize(): string {
    const form: SerialForm = { v: SERIAL_VERSION, e: Array.from(this.store.entries()) };
    return JSON.stringify(form);
  }

  /**
   * Load previously serialized entries (replacing current content). Tolerant:
   * invalid JSON, wrong version, or a malformed shape yields an empty cache —
   * a corrupt cache file must never break the plugin. Does not mark dirty.
   */
  hydrate(json: string): void {
    this.store.clear();
    this.chars = 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const form = parsed as Partial<SerialForm>;
    if (form.v !== SERIAL_VERSION || !Array.isArray(form.e)) return;
    for (const pair of form.e) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [key, value] = pair;
      if (typeof key !== "string" || typeof value !== "string") continue;
      this.insert(key, value);
    }
  }

  private insert(key: string, value: string): void {
    const existing = this.store.get(key);
    if (existing !== undefined) {
      this.store.delete(key);
      this.chars -= key.length + existing.length;
    }
    this.store.set(key, value);
    this.chars += key.length + value.length;
    this.evict();
  }

  private evict(): void {
    while (this.store.size > this.maxEntries || (this.chars > this.maxChars && this.store.size > 1)) {
      const oldest = this.store.keys().next();
      if (oldest.done) return;
      const evictedValue = this.store.get(oldest.value) ?? "";
      this.store.delete(oldest.value);
      this.chars -= oldest.value.length + evictedValue.length;
    }
  }
}
