import { describe, it, expect } from "vitest";
import {
  BlockDescriptor,
  classifyBlock,
  isTranslatable,
  hasTranslatableText,
  isLikelyTargetLanguage,
} from "../core/blockRules";

function block(overrides: Partial<BlockDescriptor> = {}): BlockDescriptor {
  return {
    kind: "p",
    text: "Hello world",
    hasCodeOnly: false,
    hasMathOnly: false,
    isImageOnly: false,
    isLinkUrlOnly: false,
    ...overrides,
  };
}

describe("blockRules", () => {
  it("translates a normal paragraph", () => {
    expect(classifyBlock(block())).toEqual({ translatable: true });
    expect(isTranslatable(block())).toBe(true);
  });

  it("skips empty / whitespace-only blocks", () => {
    expect(classifyBlock(block({ text: "" })).reason).toBe("empty");
    expect(classifyBlock(block({ text: "   \n\t " })).reason).toBe("empty");
  });

  it("skips code blocks (by flag or by kind)", () => {
    expect(classifyBlock(block({ hasCodeOnly: true })).reason).toBe("code");
    expect(classifyBlock(block({ kind: "pre", text: "const x = 1" })).reason).toBe("code");
    expect(classifyBlock(block({ kind: "code", text: "x()" })).reason).toBe("code");
  });

  it("skips math-only blocks", () => {
    expect(classifyBlock(block({ hasMathOnly: true, text: "E = mc^2" })).reason).toBe("math");
  });

  it("skips image-only blocks", () => {
    expect(classifyBlock(block({ isImageOnly: true, text: "diagram" })).reason).toBe("image-only");
  });

  it("skips bare-URL link blocks", () => {
    expect(
      classifyBlock(block({ isLinkUrlOnly: true, text: "https://example.com" })).reason
    ).toBe("link-url-only");
  });

  it("skips horizontal rules / non-text kinds", () => {
    expect(classifyBlock(block({ kind: "hr", text: "---" })).reason).toBe("non-text-kind");
  });

  it("skips symbol/number-only blocks (no letters in any script)", () => {
    expect(classifyBlock(block({ text: "123 456" })).reason).toBe("symbols-only");
    expect(classifyBlock(block({ text: "—•★ 100% !!!" })).reason).toBe("symbols-only");
    expect(classifyBlock(block({ text: "😀🎉" })).reason).toBe("symbols-only");
  });

  it("treats text with any letter (incl. CJK / accents / Cyrillic) as translatable", () => {
    expect(isTranslatable(block({ text: "2024年" }))).toBe(true);
    expect(isTranslatable(block({ text: "café" }))).toBe(true);
    expect(hasTranslatableText("Привет")).toBe(true);
    expect(hasTranslatableText("123")).toBe(false);
  });
});

describe("isLikelyTargetLanguage", () => {
  it("skips Chinese text when target is zh (incl. a few inline English terms)", () => {
    expect(isLikelyTargetLanguage("这是一段中文内容。", "zh-CN")).toBe(true);
    expect(isLikelyTargetLanguage("我用 React 和 TypeScript 写代码。", "zh-CN")).toBe(true);
  });

  it("translates English text when target is zh (even with a couple Chinese chars)", () => {
    expect(isLikelyTargetLanguage("This is an English paragraph.", "zh-CN")).toBe(false);
    expect(isLikelyTargetLanguage("This English paragraph mentions 中文 once.", "zh-CN")).toBe(false);
  });

  it("skips English when target is en, translates Chinese", () => {
    expect(isLikelyTargetLanguage("A normal English sentence.", "en")).toBe(true);
    expect(isLikelyTargetLanguage("整段中文内容。", "en")).toBe(false);
  });

  it("returns false for unknown target languages (translate to be safe)", () => {
    expect(isLikelyTargetLanguage("anything 任何", "xx-YY")).toBe(false);
  });

  it("returns false when there are no letters", () => {
    expect(isLikelyTargetLanguage("123 — 456 !!!", "zh-CN")).toBe(false);
  });
});
