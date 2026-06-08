/**
 * Reading-view render layer.
 *
 * The DOM-bound seam: it walks the rendered reading container and builds plain
 * {@link BlockDescriptor}s, delegating every "translate this?" decision to the
 * pure rules in core/blockRules. Injected translations are sibling DOM nodes
 * with a stable class — the original markdown file is never touched.
 *
 * This module imports `obsidian`/DOM and is therefore NEVER imported by tests.
 * It performs NO translation and NO network calls (that is the FAB's job).
 */
import { MarkdownRenderer } from "obsidian";
import type { App, Component } from "obsidian";
import { BlockDescriptor, BlockKind, isTranslatable } from "../core/blockRules";
import type { DisplayMode } from "../settings";

export const SOURCE_CLASS = "it-source";
export const TRANSLATION_CLASS = "it-translation";
export const MODE_BILINGUAL_CLASS = "it-mode-bilingual";
export const MODE_TRANSLATION_ONLY_CLASS = "it-mode-translation-only";

const TAG_TO_KIND: Record<string, BlockKind> = {
  p: "p",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  li: "li",
  blockquote: "blockquote",
  td: "td",
  th: "th",
  dd: "dd",
  dt: "dt",
  caption: "caption",
  pre: "pre",
  code: "code",
  hr: "hr",
};

// Outermost block elements collected from the rendered reading view.
const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, dl";
const CODE_SELECTOR = "pre, code";
const MATH_SELECTOR = ".math, mjx-container, mjx-math";
const IMAGE_SELECTOR = "img, .internal-embed, .image-embed";
const URL_ONLY_RE = /^https?:\/\/\S+$/i;

function kindOf(el: HTMLElement): BlockKind {
  return TAG_TO_KIND[el.tagName.toLowerCase()] ?? "other";
}

/** Trimmed text of `el` with all `selector` descendants removed. */
function textWithout(el: HTMLElement, selector: string): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(selector).forEach((n) => n.remove());
  return (clone.textContent ?? "").trim();
}

/** Thin DOM -> plain-data adapter. All decisions live in the pure rules. */
export function describeBlock(el: HTMLElement): BlockDescriptor {
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent ?? "").trim();

  const hasCode = tag === "pre" || tag === "code" || el.querySelector(CODE_SELECTOR) !== null;
  const hasMath = el.querySelector(MATH_SELECTOR) !== null;
  const hasImage = el.querySelector(IMAGE_SELECTOR) !== null;

  return {
    kind: kindOf(el),
    text,
    hasCodeOnly: hasCode && textWithout(el, CODE_SELECTOR) === "",
    hasMathOnly: hasMath && textWithout(el, MATH_SELECTOR) === "",
    isImageOnly: hasImage && textWithout(el, IMAGE_SELECTOR) === "",
    isLinkUrlOnly: text.length > 0 && URL_ONLY_RE.test(text),
  };
}

function getTopLevelBlocks(container: HTMLElement): HTMLElement[] {
  const all = Array.from(container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  // Keep only outermost blocks (drop e.g. <li>/<code> nested inside a kept block).
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

export interface CollectedBlock {
  el: HTMLElement;
  descriptor: BlockDescriptor;
}

/** Collect the translatable source blocks from a rendered reading container. */
export function collectTranslatableBlocks(container: HTMLElement): CollectedBlock[] {
  const out: CollectedBlock[] = [];
  for (const el of getTopLevelBlocks(container)) {
    const descriptor = describeBlock(el);
    if (isTranslatable(descriptor)) out.push({ el, descriptor });
  }
  return out;
}

export interface InjectContext {
  app: App;
  sourcePath: string;
  component: Component;
}

/**
 * Inject (or replace) a translation node as the sibling immediately after
 * `sourceEl`. Idempotent: re-running replaces the existing `.it-translation`
 * rather than stacking duplicates.
 */
export async function injectTranslation(
  sourceEl: HTMLElement,
  translatedMarkdown: string,
  ctx: InjectContext
): Promise<HTMLElement> {
  sourceEl.addClass(SOURCE_CLASS);

  let node = sourceEl.nextElementSibling as HTMLElement | null;
  if (node && node.hasClass(TRANSLATION_CLASS)) {
    node.empty();
  } else {
    node = createDiv({ cls: TRANSLATION_CLASS });
    sourceEl.insertAdjacentElement("afterend", node);
  }

  await MarkdownRenderer.render(ctx.app, translatedMarkdown, node, ctx.sourcePath, ctx.component);
  return node;
}

/** Remove all injected translations and source markers, restoring the original view. */
export function clearTranslations(container: HTMLElement): void {
  container.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((n) => n.remove());
  container
    .querySelectorAll<HTMLElement>(`.${SOURCE_CLASS}`)
    .forEach((n) => n.removeClass(SOURCE_CLASS));
}

/** Switch display mode by class only — never re-requests translations. */
export function applyDisplayMode(container: HTMLElement, mode: DisplayMode): void {
  container.toggleClass(MODE_BILINGUAL_CLASS, mode === "bilingual");
  container.toggleClass(MODE_TRANSLATION_ONLY_CLASS, mode === "translation-only");
}
