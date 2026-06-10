import { describe, it, expect } from "vitest";
import { cacheKey, TranslationCache } from "../translator/cache";

describe("cacheKey", () => {
  it("is deterministic for the same (text, model, lang)", () => {
    expect(cacheKey("hello", "m", "zh")).toBe(cacheKey("hello", "m", "zh"));
  });

  it("changes when the text changes", () => {
    expect(cacheKey("a", "m", "zh")).not.toBe(cacheKey("b", "m", "zh"));
  });

  it("changes when the model changes (invalidation)", () => {
    expect(cacheKey("a", "m1", "zh")).not.toBe(cacheKey("a", "m2", "zh"));
  });

  it("changes when the target language changes (invalidation)", () => {
    expect(cacheKey("a", "m", "zh")).not.toBe(cacheKey("a", "m", "en"));
  });

  it("is collision-safe across field boundaries", () => {
    // ("ab","c") vs ("a","bc") must not fold into the same key.
    expect(cacheKey("x", "ab", "c")).not.toBe(cacheKey("x", "a", "bc"));
  });
});

describe("TranslationCache", () => {
  it("stores and retrieves by content + model + lang", () => {
    const c = new TranslationCache();
    expect(c.has("src", "m", "zh")).toBe(false);
    c.set("src", "m", "zh", "译文");
    expect(c.has("src", "m", "zh")).toBe(true);
    expect(c.get("src", "m", "zh")).toBe("译文");
    expect(c.size).toBe(1);
  });

  it("misses when model or lang differ", () => {
    const c = new TranslationCache();
    c.set("src", "m", "zh", "译文");
    expect(c.get("src", "m2", "zh")).toBeUndefined();
    expect(c.get("src", "m", "en")).toBeUndefined();
  });

  it("clears", () => {
    const c = new TranslationCache();
    c.set("a", "m", "zh", "x");
    c.clear();
    expect(c.size).toBe(0);
    expect(c.charSize).toBe(0);
  });

  it("evicts the least-recently-used entry beyond maxEntries", () => {
    const c = new TranslationCache({ maxEntries: 2 });
    c.set("a", "m", "zh", "A");
    c.set("b", "m", "zh", "B");
    c.set("c", "m", "zh", "C"); // evicts "a"
    expect(c.size).toBe(2);
    expect(c.get("a", "m", "zh")).toBeUndefined();
    expect(c.get("b", "m", "zh")).toBe("B");
    expect(c.get("c", "m", "zh")).toBe("C");
  });

  it("a get() refreshes recency so the entry survives eviction", () => {
    const c = new TranslationCache({ maxEntries: 2 });
    c.set("a", "m", "zh", "A");
    c.set("b", "m", "zh", "B");
    c.get("a", "m", "zh"); // touch "a" — now "b" is oldest
    c.set("c", "m", "zh", "C"); // evicts "b"
    expect(c.get("a", "m", "zh")).toBe("A");
    expect(c.get("b", "m", "zh")).toBeUndefined();
  });

  it("evicts oldest entries when over the char budget", () => {
    const c = new TranslationCache({ maxChars: 100 });
    c.set("first", "m", "zh", "x".repeat(60));
    c.set("second", "m", "zh", "y".repeat(60)); // both can't fit in 100 chars
    expect(c.get("first", "m", "zh")).toBeUndefined();
    expect(c.get("second", "m", "zh")).toBe("y".repeat(60));
  });

  it("never evicts down to zero entries (a single oversized entry is kept)", () => {
    const c = new TranslationCache({ maxChars: 10 });
    c.set("big", "m", "zh", "z".repeat(500));
    expect(c.size).toBe(1);
  });

  it("overwriting a key updates char accounting instead of double-counting", () => {
    const c = new TranslationCache();
    c.set("a", "m", "zh", "12345");
    const after = c.charSize;
    c.set("a", "m", "zh", "12345");
    expect(c.charSize).toBe(after);
    expect(c.size).toBe(1);
  });

  it("fires onDirty for set/clear but not for get", () => {
    const c = new TranslationCache();
    let dirty = 0;
    c.onDirty = () => dirty++;
    c.set("a", "m", "zh", "x");
    expect(dirty).toBe(1);
    c.get("a", "m", "zh");
    expect(dirty).toBe(1);
    c.clear();
    expect(dirty).toBe(2);
    c.clear(); // already empty — no spurious dirty
    expect(dirty).toBe(2);
  });
});

describe("TranslationCache serialization", () => {
  it("round-trips entries through serialize/hydrate", () => {
    const a = new TranslationCache();
    a.set("hello", "m", "zh", "你好");
    a.set("world", "m", "zh", "世界");
    const b = new TranslationCache();
    b.hydrate(a.serialize());
    expect(b.size).toBe(2);
    expect(b.get("hello", "m", "zh")).toBe("你好");
    expect(b.get("world", "m", "zh")).toBe("世界");
    expect(b.charSize).toBe(a.charSize);
  });

  it("preserves LRU order across a round-trip", () => {
    const a = new TranslationCache();
    a.set("old", "m", "zh", "旧");
    a.set("new", "m", "zh", "新");
    const b = new TranslationCache({ maxEntries: 2 });
    b.hydrate(a.serialize());
    b.set("extra", "m", "zh", "另"); // must evict "old", the oldest
    expect(b.get("old", "m", "zh")).toBeUndefined();
    expect(b.get("new", "m", "zh")).toBe("新");
  });

  it("hydrate replaces existing content", () => {
    const a = new TranslationCache();
    a.set("keep", "m", "zh", "x");
    const empty = new TranslationCache();
    a.hydrate(empty.serialize());
    expect(a.size).toBe(0);
  });

  it("tolerates corrupt or foreign JSON (empty cache, no throw)", () => {
    const c = new TranslationCache();
    for (const junk of ["not json {", "42", "null", '{"v":99,"e":[]}', '{"v":1,"e":"nope"}']) {
      c.hydrate(junk);
      expect(c.size).toBe(0);
    }
  });

  it("skips malformed pairs but keeps valid ones", () => {
    const c = new TranslationCache();
    c.hydrate(JSON.stringify({ v: 1, e: [["k1", "v1"], ["only-key"], [2, "x"], ["k2", "v2"]] }));
    expect(c.size).toBe(2);
  });

  it("respects the instance caps while hydrating", () => {
    const a = new TranslationCache();
    a.set("a", "m", "zh", "A");
    a.set("b", "m", "zh", "B");
    a.set("c", "m", "zh", "C");
    const small = new TranslationCache({ maxEntries: 2 });
    small.hydrate(a.serialize());
    expect(small.size).toBe(2);
    expect(small.get("a", "m", "zh")).toBeUndefined(); // oldest dropped
  });

  it("does not fire onDirty during hydrate", () => {
    const a = new TranslationCache();
    a.set("a", "m", "zh", "A");
    const b = new TranslationCache();
    let dirty = 0;
    b.onDirty = () => dirty++;
    b.hydrate(a.serialize());
    expect(dirty).toBe(0);
  });
});
