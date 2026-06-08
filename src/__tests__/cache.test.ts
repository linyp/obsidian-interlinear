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

  it("uses an injectable backing store", () => {
    const store = new Map<string, string>();
    const c = new TranslationCache(store);
    c.set("src", "m", "zh", "译文");
    expect(store.size).toBe(1);
  });

  it("clears", () => {
    const c = new TranslationCache();
    c.set("a", "m", "zh", "x");
    c.clear();
    expect(c.size).toBe(0);
  });
});
