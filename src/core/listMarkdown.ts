/**
 * List-aware reassembly of translated text — PURE (no obsidian, no DOM).
 *
 * A rendered <ul>/<ol> is collected as ONE block whose text is the items
 * joined by newlines with the markdown markers already gone (bullets are CSS
 * ::marker, not text). Translators therefore return marker-less lines, which
 * MarkdownRenderer would show as a plain soft-wrapped paragraph. When the
 * translated line count matches the list's direct item count, we can safely
 * put the markers back so the translation renders as a real list again.
 * Nested lists (item count ≠ line count) fall back to the caller's original
 * text — same best-effort behavior as before.
 */

const LIST_MARKER_RE = /^([-*+]|\d+[.)])\s/;

/**
 * Rebuild list markdown from a line-per-item translation. Returns null when
 * the lines can't be confidently mapped to items (caller renders unchanged).
 */
export function listMarkdownFromLines(
  translated: string,
  ordered: boolean,
  itemCount: number
): string | null {
  const lines = translated
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (itemCount === 0 || lines.length !== itemCount) return null;
  // Already marked (e.g. an LLM preserved list syntax) — don't double-prefix.
  if (lines.every((l) => LIST_MARKER_RE.test(l))) return lines.join("\n");
  return lines.map((l, i) => (ordered ? `${i + 1}. ${l}` : `- ${l}`)).join("\n");
}
