import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { md5Hex } from "../core/md5";

/** Oracle: Node's OpenSSL-backed MD5 (tests run in Node; the plugin does not). */
function nodeMd5(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

describe("md5Hex", () => {
  it("matches the RFC 1321 test-suite vectors", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
    expect(
      md5Hex("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
    ).toBe("d174ab98d277d9f5a5611c2c9f419d9f");
    expect(
      md5Hex("12345678901234567890123456789012345678901234567890123456789012345678901234567890")
    ).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });

  it("hashes the UTF-8 encoding of multi-byte text (CJK, emoji)", () => {
    for (const input of ["中文", "你好,世界", "héllo wörld", "🌍 emoji + 中文 mixed"]) {
      expect(md5Hex(input)).toBe(nodeMd5(input));
    }
  });

  it("matches Node across padding boundary lengths (55/56/63/64/65 bytes)", () => {
    // Message-length edge cases around the 64-byte block and the 8-byte
    // length-suffix cutover — the classic places an MD5 padding bug hides.
    for (const len of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const input = "x".repeat(len);
      expect(md5Hex(input)).toBe(nodeMd5(input));
    }
  });

  it("matches Node on a realistic signing payload", () => {
    const payload = "20240001" + "What is the meaning of life?\nSecond line." + "72351" + "sk-secret";
    expect(md5Hex(payload)).toBe(nodeMd5(payload));
  });
});
