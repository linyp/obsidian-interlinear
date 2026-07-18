// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./domTestSetup";

const { render } = vi.hoisted(() => ({ render: vi.fn() }));

vi.mock("obsidian", () => ({
  MarkdownRenderer: { render },
}));

import {
  applyDisplayMode,
  applyTranslationStyle,
  clearTranslations,
  collectSourceBlockTexts,
  collectTranslatableBlocks,
  injectTranslation,
  MODE_BILINGUAL_CLASS,
  MODE_TRANSLATION_ONLY_CLASS,
  SOURCE_CLASS,
  TRANSLATION_CLASS,
} from "../render/postProcessor";

beforeAll(installObsidianDomHelpers);

beforeEach(() => {
  document.body.replaceChildren();
  render.mockReset();
  render.mockImplementation(async (_app, markdown: string, target: HTMLElement) => {
    target.textContent = markdown;
  });
});

describe("postProcessor DOM adapter", () => {
  it("collects outer translatable blocks and skips code/math/image/URL-only blocks", () => {
    const container = document.createElement("div");
    container.innerHTML = [
      "<p>Translate me</p>",
      "<pre><code>const x = 1</code></pre>",
      '<p><span class="math">x + y</span></p>',
      '<p><img src="x.png"></p>',
      "<p>https://example.com</p>",
      "<ul><li>First</li><li>Second</li></ul>",
    ].join("");

    expect(collectTranslatableBlocks(container).map((b) => b.descriptor.text)).toEqual([
      "Translate me",
      "FirstSecond",
    ]);
  });

  it("injects idempotently as a sibling and preserves list structure", async () => {
    const host = document.createElement("div");
    host.innerHTML = "<ul><li>One</li><li>Two</li></ul>";
    const source = host.firstElementChild as HTMLElement;
    const ctx = { app: {} as never, sourcePath: "note.md", component: {} as never };

    const first = await injectTranslation(source, "一\n二", ctx);
    const second = await injectTranslation(source, "甲\n乙", ctx);

    expect(first).toBe(second);
    expect(host.querySelectorAll(`.${TRANSLATION_CLASS}`)).toHaveLength(1);
    expect(source.hasClass(SOURCE_CLASS)).toBe(true);
    expect(render).toHaveBeenLastCalledWith(
      ctx.app,
      "- 甲\n- 乙",
      second,
      "note.md",
      ctx.component
    );
  });

  it("switches mode/style by class and clears every injected artifact", () => {
    const container = document.createElement("div");
    container.innerHTML = [
      `<p class="${SOURCE_CLASS}">Source<span class="it-loading"></span></p>`,
      `<div class="${TRANSLATION_CLASS}">Translation</div>`,
    ].join("");

    applyDisplayMode(container, "translation-only");
    applyTranslationStyle(container, "mask");
    expect(container.hasClass(MODE_TRANSLATION_ONLY_CLASS)).toBe(true);
    expect(container.hasClass(MODE_BILINGUAL_CLASS)).toBe(false);
    expect(container.hasClass("it-style-mask")).toBe(true);

    applyDisplayMode(container, "bilingual");
    applyTranslationStyle(container, "border");
    expect(container.hasClass(MODE_BILINGUAL_CLASS)).toBe(true);
    expect(container.hasClass("it-style-mask")).toBe(false);
    expect(container.hasClass("it-style-border")).toBe(true);

    clearTranslations(container);
    expect(container.querySelector(`.${TRANSLATION_CLASS}`)).toBeNull();
    expect(container.querySelector(".it-loading")).toBeNull();
    expect(container.querySelector(`.${SOURCE_CLASS}`)).toBeNull();
  });

  it("renders the whole source off-screen, de-duplicates text, and removes the helper", async () => {
    const host = document.createElement("div");
    render.mockImplementation(async (_app, _markdown: string, target: HTMLElement) => {
      target.innerHTML = "<p>Alpha</p><p>Alpha</p><p>Beta</p><pre><code>x</code></pre>";
    });

    await expect(
      collectSourceBlockTexts({} as never, "source", host, {} as never)
    ).resolves.toEqual(["Alpha", "Beta"]);
    expect(host.querySelector(".it-offscreen-render")).toBeNull();
  });
});
