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
import { listMarkdownFromLines } from "../core/listMarkdown";
import type { DisplayMode, TranslationStyle } from "../settings";

export const SOURCE_CLASS = "it-source";
export const TRANSLATION_CLASS = "it-translation";
export const OFFSCREEN_CLASS = "it-offscreen-render";
export const LOADING_CLASS = "it-loading";
export const MODE_BILINGUAL_CLASS = "it-mode-bilingual";
export const MODE_TRANSLATION_ONLY_CLASS = "it-mode-translation-only";
/** Per-block marker toggled on tap (mobile) to reveal the original inline. */
export const SHOW_SOURCE_CLASS = "it-show-source";

const STYLE_CLASS_PREFIX = "it-style-";
const ALL_STYLE_CLASSES: string[] = ["border", "quote", "muted", "dashed", "mask"].map(
  (s) => STYLE_CLASS_PREFIX + s
);

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

function getTopLevelBlocks(root: HTMLElement): HTMLElement[] {
  // Consider the root itself (the post-processor passes a block/section element)
  // plus descendant blocks; the reading container itself won't match.
  const all: HTMLElement[] = [];
  if (root.matches(BLOCK_SELECTOR)) all.push(root);
  all.push(...Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)));
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
    // Skip our own injected translations (avoids recursive re-translation, since
    // MarkdownRenderer.render runs post-processors on rendered content) and the
    // hidden off-screen pre-translation container.
    if (el.closest(`.${TRANSLATION_CLASS}, .${OFFSCREEN_CLASS}`)) continue;
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
 * A list block's translation comes back as marker-less lines (see
 * core/listMarkdown). Put the list markers back when the lines map 1:1 onto
 * the list's direct items, so the translation renders as a list again.
 */
function listAwareMarkdown(sourceEl: HTMLElement, translated: string): string {
  const tag = sourceEl.tagName.toLowerCase();
  if (tag !== "ul" && tag !== "ol") return translated;
  const itemCount = sourceEl.querySelectorAll(":scope > li").length;
  return listMarkdownFromLines(translated, tag === "ol", itemCount) ?? translated;
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

  const markdown = listAwareMarkdown(sourceEl, translatedMarkdown);
  await MarkdownRenderer.render(ctx.app, markdown, node, ctx.sourcePath, ctx.component);
  return node;
}

/**
 * Render the full note markdown into a hidden (but attached) element — a plain
 * MarkdownRenderer.render is NOT virtualized, so this yields the WHOLE document —
 * and return the de-duplicated translatable block texts. Lets us pre-translate
 * the entire note so on-scroll rendering shows cached results instantly, without
 * forcing the live reading view to scroll.
 *
 * `sourcePath` is intentionally empty so the plugin's own post-processor ignores
 * this render (its onBlockRendered keys off the active note's real path).
 */
export async function collectSourceBlockTexts(
  app: App,
  markdown: string,
  host: HTMLElement,
  component: Component
): Promise<string[]> {
  const div = host.createDiv({ cls: OFFSCREEN_CLASS });
  try {
    await MarkdownRenderer.render(app, markdown, div, "", component);
    const seen = new Set<string>();
    for (const el of getTopLevelBlocks(div)) {
      if (el.closest(`.${TRANSLATION_CLASS}`)) continue;
      const descriptor = describeBlock(el);
      if (isTranslatable(descriptor)) seen.add(descriptor.text);
    }
    return Array.from(seen);
  } finally {
    div.remove();
  }
}

/** Show/hide a small spinner at the end of a block while it is being translated. */
export function setBlockLoading(el: HTMLElement, loading: boolean): void {
  const existing = el.querySelector<HTMLElement>(`:scope > .${LOADING_CLASS}`);
  if (loading) {
    if (!existing) el.createSpan({ cls: LOADING_CLASS, attr: { "aria-hidden": "true" } });
  } else {
    existing?.remove();
  }
}

/** Remove all injected translations, loading spinners, and source markers. */
export function clearTranslations(container: HTMLElement): void {
  container.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((n) => n.remove());
  container.querySelectorAll(`.${LOADING_CLASS}`).forEach((n) => n.remove());
  container
    .querySelectorAll<HTMLElement>(`.${SOURCE_CLASS}`)
    .forEach((n) => n.removeClass(SOURCE_CLASS));
}

/** Switch display mode by class only — never re-requests translations. */
export function applyDisplayMode(container: HTMLElement, mode: DisplayMode): void {
  container.toggleClass(MODE_BILINGUAL_CLASS, mode === "bilingual");
  container.toggleClass(MODE_TRANSLATION_ONLY_CLASS, mode === "translation-only");
}

/** Switch the translation visual theme by class only — never re-requests. */
export function applyTranslationStyle(container: HTMLElement, style: TranslationStyle): void {
  for (const cls of ALL_STYLE_CLASSES) container.removeClass(cls);
  container.addClass(STYLE_CLASS_PREFIX + style);
}
