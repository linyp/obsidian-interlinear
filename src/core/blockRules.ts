/**
 * Pure "should this block be translated?" rules.
 *
 * Operates on a minimal {@link BlockDescriptor} (plain data) rather than live
 * DOM nodes, so the rules are fully unit-testable without Obsidian or a DOM.
 * The render layer's only job is the thin `describeBlock(el) -> BlockDescriptor`
 * adapter (Milestone 3) that feeds these predicates.
 */

export type BlockKind =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "li"
  | "blockquote"
  | "td"
  | "th"
  | "dd"
  | "dt"
  | "caption"
  | "pre"
  | "code"
  | "hr"
  | "other";

export interface BlockDescriptor {
  /** Lowercased tag/role of the block. */
  kind: BlockKind;
  /** textContent (will be trimmed by the rules). */
  text: string;
  /** Block is, or contains only, code / preformatted content. */
  hasCodeOnly: boolean;
  /** Block is only math (inline/block formula). */
  hasMathOnly: boolean;
  /** Block contains only image(s)/embeds, no prose. */
  isImageOnly: boolean;
  /** The block's text is a single bare URL. */
  isLinkUrlOnly: boolean;
}

export type SkipReason =
  | "empty"
  | "code"
  | "math"
  | "image-only"
  | "link-url-only"
  | "symbols-only"
  | "non-text-kind";

export interface Classification {
  translatable: boolean;
  reason?: SkipReason;
}

// Any Unicode letter (Latin, CJK, Cyrillic, ...). Blocks with no letters at all
// (pure punctuation/numbers/symbols/emoji) are not worth translating.
const LETTER_RE = /\p{L}/u;

/** True if the text contains at least one letter in any script. */
export function hasTranslatableText(text: string): boolean {
  return LETTER_RE.test(text);
}

/** Classify a block, returning translatability and (if skipped) the reason. */
export function classifyBlock(b: BlockDescriptor): Classification {
  const text = b.text.trim();
  if (text.length === 0) return { translatable: false, reason: "empty" };
  if (b.hasCodeOnly || b.kind === "pre" || b.kind === "code") {
    return { translatable: false, reason: "code" };
  }
  if (b.hasMathOnly) return { translatable: false, reason: "math" };
  if (b.isImageOnly) return { translatable: false, reason: "image-only" };
  if (b.isLinkUrlOnly) return { translatable: false, reason: "link-url-only" };
  if (b.kind === "hr") return { translatable: false, reason: "non-text-kind" };
  if (!hasTranslatableText(text)) {
    return { translatable: false, reason: "symbols-only" };
  }
  return { translatable: true };
}

/** Convenience predicate. */
export function isTranslatable(b: BlockDescriptor): boolean {
  return classifyBlock(b).translatable;
}

// --- "already in the target language?" heuristic ---------------------------
//
// Same-language detection is only RELIABLE across distinct scripts. A block in a
// language-distinctive script (CJK, Thai, Hebrew, Greek) is almost certainly that
// language, so we can skip it. For scripts SHARED by many languages (Latin →
// en/fr/de/…, Cyrillic → ru/uk/…, Arabic → ar/fa/…, Devanagari → hi/mr/…) the
// script cannot identify the language, so we DON'T skip (translate) — otherwise a
// French block would be wrongly skipped when the target is English. Telling those
// apart needs a real language detector; this heuristic stays deliberately safe.
//
// Counting is per token: each CJK/Thai character is one token, each run of letters
// in an alphabetic script is one (word) token — so a Chinese sentence with a few
// English terms still reads as mostly-Chinese.

type ScriptBucket =
  | "Han"
  | "Kana"
  | "Hangul"
  | "Thai"
  | "Latin"
  | "Cyrillic"
  | "Arabic"
  | "Hebrew"
  | "Greek"
  | "Other";

const PER_CHAR_SCRIPTS = new Set<ScriptBucket>(["Han", "Kana", "Hangul", "Thai"]);

function charScript(ch: string): ScriptBucket | null {
  if (!LETTER_RE.test(ch)) return null;
  if (/\p{Script=Han}/u.test(ch)) return "Han";
  if (/\p{Script=Hiragana}/u.test(ch) || /\p{Script=Katakana}/u.test(ch)) return "Kana";
  if (/\p{Script=Hangul}/u.test(ch)) return "Hangul";
  if (/\p{Script=Thai}/u.test(ch)) return "Thai";
  if (/\p{Script=Hebrew}/u.test(ch)) return "Hebrew";
  if (/\p{Script=Greek}/u.test(ch)) return "Greek";
  if (/\p{Script=Latin}/u.test(ch)) return "Latin";
  if (/\p{Script=Cyrillic}/u.test(ch)) return "Cyrillic";
  if (/\p{Script=Arabic}/u.test(ch)) return "Arabic";
  return "Other"; // any other letter (Devanagari, etc.) — counted but never a skip target
}

function scriptTokenCounts(text: string): { total: number; byScript: Map<ScriptBucket, number> } {
  const byScript = new Map<ScriptBucket, number>();
  let total = 0;
  let pendingWord: ScriptBucket | null = null;
  const add = (s: ScriptBucket) => {
    byScript.set(s, (byScript.get(s) ?? 0) + 1);
    total++;
  };
  const flushWord = () => {
    if (pendingWord) {
      add(pendingWord);
      pendingWord = null;
    }
  };
  for (const ch of text) {
    const s = charScript(ch);
    if (s === null) {
      flushWord(); // non-letter ends a word run
      continue;
    }
    if (PER_CHAR_SCRIPTS.has(s)) {
      flushWord();
      add(s); // each CJK/Thai character is its own token
    } else {
      if (pendingWord && pendingWord !== s) flushWord();
      pendingWord = s; // accumulate an alphabetic-script word run
    }
  }
  flushWord();
  return { total, byScript };
}

/** Target languages whose script reliably identifies them (safe to skip). */
function distinctiveTarget(targetLang: string): "zh" | "ja" | "ko" | "th" | "he" | "el" | null {
  const base = targetLang.trim().toLowerCase().split(/[-_]/)[0];
  switch (base) {
    case "zh":
      return "zh";
    case "ja":
      return "ja";
    case "ko":
      return "ko";
    case "th":
      return "th";
    case "he":
    case "iw":
      return "he";
    case "el":
      return "el";
    default:
      return null; // shared-script or unknown language → can't tell apart → translate
  }
}

/**
 * Heuristic: is the text already in the target language? Reliable only for
 * language-distinctive scripts; returns false (→ translate) for shared-script
 * targets (Latin/Cyrillic/Arabic/…) and unknown languages, so a different
 * same-script language is never wrongly skipped.
 */
export function isLikelyTargetLanguage(text: string, targetLang: string, threshold = 0.7): boolean {
  const t = distinctiveTarget(targetLang);
  if (!t) return false;
  const { total, byScript } = scriptTokenCounts(text);
  if (total === 0) return false;
  const n = (s: ScriptBucket): number => byScript.get(s) ?? 0;
  const frac = (s: ScriptBucket): number => n(s) / total;
  switch (t) {
    case "ko":
      return frac("Hangul") >= threshold;
    case "ja":
      return n("Kana") > 0 && (n("Han") + n("Kana")) / total >= threshold; // kana confirms Japanese
    case "zh":
      return n("Kana") === 0 && frac("Han") >= threshold; // Han-dominant, not Japanese
    case "th":
      return frac("Thai") >= threshold;
    case "he":
      return frac("Hebrew") >= threshold;
    case "el":
      return frac("Greek") >= threshold;
    default:
      return false;
  }
}
