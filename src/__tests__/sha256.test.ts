import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex } from "../core/sha256";

describe("sha256Hex", () => {
  it("matches the FIPS 180 vectors", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashes the UTF-8 encoding of multi-byte text", async () => {
    for (const input of ["中文", "app翻译内容salt1690000000secret", "🌍"]) {
      const expected = createHash("sha256").update(input, "utf8").digest("hex");
      expect(await sha256Hex(input)).toBe(expected);
    }
  });
});
