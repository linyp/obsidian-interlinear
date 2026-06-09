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
// Used to skip blocks that don't need translating (e.g. Chinese paragraphs when
// the target is Chinese), so same-language content triggers no request. We tokenize
// by script — each CJK character counts as one token, each run of Latin/Cyrillic/
// Arabic letters counts as one (word) token — so a Chinese sentence with a few
// English terms still reads as mostly-Chinese.

type TargetScript = "Han" | "Kana" | "Hangul" | "Latin" | "Cyrillic" | "Arabic";

function charScript(ch: string): TargetScript | null {
  if (/\p{Script=Han}/u.test(ch)) return "Han";
  if (/\p{Script=Hiragana}/u.test(ch) || /\p{Script=Katakana}/u.test(ch)) return "Kana";
  if (/\p{Script=Hangul}/u.test(ch)) return "Hangul";
  if (/\p{Script=Latin}/u.test(ch)) return "Latin";
  if (/\p{Script=Cyrillic}/u.test(ch)) return "Cyrillic";
  if (/\p{Script=Arabic}/u.test(ch)) return "Arabic";
  return null;
}

/** Map a BCP-47-ish target language to the script(s) its text is written in. */
function targetScripts(targetLang: string): TargetScript[] | null {
  const base = targetLang.trim().toLowerCase().split(/[-_]/)[0];
  switch (base) {
    case "zh":
      return ["Han"];
    case "ja":
      return ["Han", "Kana"];
    case "ko":
      return ["Hangul"];
    case "ru":
    case "uk":
    case "be":
    case "bg":
    case "sr":
    case "mk":
      return ["Cyrillic"];
    case "ar":
    case "fa":
    case "ur":
      return ["Arabic"];
    case "en":
    case "fr":
    case "de":
    case "es":
    case "it":
    case "pt":
    case "nl":
    case "sv":
    case "da":
    case "nb":
    case "no":
    case "fi":
    case "pl":
    case "tr":
    case "id":
    case "ms":
    case "vi":
    case "ro":
    case "cs":
    case "hu":
    case "ca":
      return ["Latin"];
    default:
      return null; // unknown target → don't skip (translate, to be safe)
  }
}

const CJK_SCRIPTS = new Set<TargetScript>(["Han", "Kana", "Hangul"]);

function scriptTokenCounts(text: string): { total: number; byScript: Map<TargetScript, number> } {
  const byScript = new Map<TargetScript, number>();
  let total = 0;
  let pendingWord: TargetScript | null = null;
  const add = (s: TargetScript) => {
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
    if (CJK_SCRIPTS.has(s)) {
      flushWord();
      add(s); // each CJK character is its own token
    } else {
      if (pendingWord && pendingWord !== s) flushWord();
      pendingWord = s; // accumulate a Latin/Cyrillic/Arabic word run
    }
  }
  flushWord();
  return { total, byScript };
}

/**
 * Heuristic: is the text already predominantly in the target language's script?
 * Returns false for unknown target languages or text with no letters.
 */
export function isLikelyTargetLanguage(text: string, targetLang: string, threshold = 0.7): boolean {
  const scripts = targetScripts(targetLang);
  if (!scripts) return false;
  const { total, byScript } = scriptTokenCounts(text);
  if (total === 0) return false;
  let inTarget = 0;
  for (const s of scripts) inTarget += byScript.get(s) ?? 0;
  return inTarget / total >= threshold;
}
