import { describe, it, expect } from "vitest";
import { fnv1a, hashContent } from "../core/hash";

describe("hash (FNV-1a)", () => {
  it("is deterministic", () => {
    expect(hashContent("hello world")).toBe(hashContent("hello world"));
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
  });

  it("produces distinct keys for distinct inputs", () => {
    const inputs = ["", "a", "b", "ab", "ba", "hello", "Hello", "你好", "世界"];
    const hashes = inputs.map(hashContent);
    expect(new Set(hashes).size).toBe(inputs.length);
  });

  it("returns an unsigned 32-bit integer", () => {
    for (const s of ["", "x", "a longer string with spaces", "你好世界"]) {
      const h = fnv1a(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("matches the FNV-1a offset basis for the empty string (regression guard)", () => {
    expect(fnv1a("")).toBe(2166136261);
  });

  it("emits base36 strings", () => {
    expect(hashContent("anything")).toMatch(/^[0-9a-z]+$/);
  });
});
