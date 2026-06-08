/**
 * FNV-1a (32-bit) — a tiny, synchronous, dependency-free string hash.
 *
 * Chosen over Node `crypto` (unavailable in the Obsidian renderer) and
 * `SubtleCrypto` (async, overkill) because the cache key is non-security:
 * a collision only costs a redundant API call, never a correctness bug.
 */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5; // FNV offset basis (2166136261)
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619 (FNV prime), kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // force unsigned 32-bit
}

/** Stable base36 hash string for a piece of content. */
export function hashContent(text: string): string {
  return fnv1a(text).toString(36);
}
