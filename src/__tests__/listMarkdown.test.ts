import { describe, it, expect } from "vitest";
import { listMarkdownFromLines } from "../core/listMarkdown";

describe("listMarkdownFromLines", () => {
  it("prefixes bullet markers when lines map 1:1 onto items", () => {
    expect(listMarkdownFromLines("甲\n乙\n丙", false, 3)).toBe("- 甲\n- 乙\n- 丙");
  });

  it("numbers ordered lists from 1", () => {
    expect(listMarkdownFromLines("甲\n乙", true, 2)).toBe("1. 甲\n2. 乙");
  });

  it("ignores blank lines and surrounding whitespace (CRLF too)", () => {
    expect(listMarkdownFromLines("  甲 \r\n\n乙\r\n", false, 2)).toBe("- 甲\n- 乙");
  });

  it("returns null when the line count doesn't match the item count", () => {
    // e.g. a nested list: textContent has more lines than direct <li> children.
    expect(listMarkdownFromLines("甲\n乙\n丙", false, 2)).toBeNull();
    expect(listMarkdownFromLines("甲", false, 3)).toBeNull();
  });

  it("returns null for zero items or empty translations", () => {
    expect(listMarkdownFromLines("甲", false, 0)).toBeNull();
    expect(listMarkdownFromLines("", false, 1)).toBeNull();
  });

  it("keeps already-marked lines as-is instead of double-prefixing", () => {
    expect(listMarkdownFromLines("- 甲\n- 乙", false, 2)).toBe("- 甲\n- 乙");
    expect(listMarkdownFromLines("1. 甲\n2) 乙", true, 2)).toBe("1. 甲\n2) 乙");
    // Mixed (only some lines marked) still gets a uniform prefix.
    expect(listMarkdownFromLines("- 甲\n乙", false, 2)).toBe("- - 甲\n- 乙");
  });
});
