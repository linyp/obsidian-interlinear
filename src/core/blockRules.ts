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
