import { describe, it, expect } from "vitest";
import {
  selectSegments,
  packBatch,
  unpackBatch,
  chunkByBudget,
  Segment,
} from "../core/segmentation";
import { BlockDescriptor } from "../core/blockRules";

function block(text: string, overrides: Partial<BlockDescriptor> = {}): BlockDescriptor {
  return {
    kind: "p",
    text,
    hasCodeOnly: false,
    hasMathOnly: false,
    isImageOnly: false,
    isLinkUrlOnly: false,
    ...overrides,
  };
}

describe("selectSegments", () => {
  it("keeps translatable blocks with their original index, trimming text", () => {
    const blocks = [
      block("First paragraph"),
      block("code", { hasCodeOnly: true }), // skipped
      block("  Third  "), // trimmed
      block("123"), // symbols-only, skipped
      block("Fifth"),
    ];
    expect(selectSegments(blocks)).toEqual([
      { index: 0, text: "First paragraph" },
      { index: 2, text: "Third" },
      { index: 4, text: "Fifth" },
    ]);
  });

  it("returns [] when nothing is translatable", () => {
    expect(
      selectSegments([block("```", { hasCodeOnly: true }), block("---", { kind: "hr" })])
    ).toEqual([]);
  });
});

describe("packBatch / unpackBatch", () => {
  it("round-trips N segments (incl. multi-line content)", () => {
    const segs = ["Hello", "World", "多行\n内容"];
    const res = unpackBatch(packBatch(segs), 3);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.segments).toEqual(["Hello", "World", "多行\n内容"]);
  });

  it("round-trips a single segment", () => {
    const res = unpackBatch(packBatch(["only one"]), 1);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.segments).toEqual(["only one"]);
  });

  it("detects too-few segments (count mismatch)", () => {
    const res = unpackBatch(packBatch(["a", "b"]), 3);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("count-mismatch");
      expect(res.got).toBe(2);
      expect(res.expected).toBe(3);
    }
  });

  it("detects too-many segments (model returned extra, got > expected)", () => {
    const res = unpackBatch(packBatch(["a", "b", "c"]), 2);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("count-mismatch");
      expect(res.got).toBe(3);
      expect(res.expected).toBe(2);
    }
  });

  it("reports no-markers when the model dropped the contract", () => {
    const res = unpackBatch("a plain translation with no markers", 2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-markers");
  });

  it("detects non-sequential markers", () => {
    const res = unpackBatch("<<<SEG 1>>>\nfoo\n\n<<<SEG 3>>>\nbar", 2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("non-sequential");
  });

  it("ignores marker-looking text that is not alone on its line", () => {
    const res = unpackBatch("<<<SEG 1>>>\nsee <<<SEG 2>>> inline reference here", 1);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.segments[0]).toContain("inline reference");
  });
});

describe("chunkByBudget", () => {
  const seg = (index: number, text: string): Segment => ({ index, text });

  it("packs multiple small segments under the budget", () => {
    const segs = [seg(0, "aaa"), seg(1, "bbb"), seg(2, "cc")]; // 3+3+2 = 8
    expect(chunkByBudget(segs, 10)).toEqual([segs]);
  });

  it("splits when the budget is exceeded, preserving order/indices", () => {
    const segs = [seg(0, "aaaa"), seg(1, "bbbb"), seg(2, "cccc")];
    expect(chunkByBudget(segs, 8)).toEqual([
      [seg(0, "aaaa"), seg(1, "bbbb")],
      [seg(2, "cccc")],
    ]);
  });

  it("gives an oversized segment its own chunk", () => {
    const big = "x".repeat(100);
    const segs = [seg(0, "small"), seg(1, big), seg(2, "tiny")];
    expect(chunkByBudget(segs, 20)).toEqual([[seg(0, "small")], [seg(1, big)], [seg(2, "tiny")]]);
  });

  it("returns [] for no segments", () => {
    expect(chunkByBudget([], 10)).toEqual([]);
  });

  it("caps the number of segments per chunk", () => {
    const segs = [seg(0, "a"), seg(1, "b"), seg(2, "c"), seg(3, "d"), seg(4, "e")];
    // Char budget is generous; the count cap of 2 is what splits them.
    expect(chunkByBudget(segs, 1000, 2)).toEqual([
      [seg(0, "a"), seg(1, "b")],
      [seg(2, "c"), seg(3, "d")],
      [seg(4, "e")],
    ]);
  });

  it("splits on whichever cap is hit first (chars or count)", () => {
    const segs = [seg(0, "aaaa"), seg(1, "b"), seg(2, "cccc")];
    // Count cap 5 won't bite; the char budget 6 splits before "cccc".
    expect(chunkByBudget(segs, 6, 5)).toEqual([
      [seg(0, "aaaa"), seg(1, "b")],
      [seg(2, "cccc")],
    ]);
  });

  it("treats maxSegments as unbounded by default (backwards compatible)", () => {
    const segs = Array.from({ length: 50 }, (_, i) => seg(i, "x"));
    expect(chunkByBudget(segs, 1000)).toEqual([segs]);
  });
});
