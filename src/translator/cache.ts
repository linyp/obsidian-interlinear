/**
 * In-memory, session-only translation cache (no disk persistence — keeps
 * data.json small and avoids unbounded growth). The backing Map is injectable
 * so the key logic and get/set/has are unit-testable.
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

export class TranslationCache {
  private readonly store: Map<string, string>;

  constructor(store: Map<string, string> = new Map()) {
    this.store = store;
  }

  has(text: string, model: string, targetLang: string): boolean {
    return this.store.has(cacheKey(text, model, targetLang));
  }

  get(text: string, model: string, targetLang: string): string | undefined {
    return this.store.get(cacheKey(text, model, targetLang));
  }

  set(text: string, model: string, targetLang: string, translation: string): void {
    this.store.set(cacheKey(text, model, targetLang), translation);
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
