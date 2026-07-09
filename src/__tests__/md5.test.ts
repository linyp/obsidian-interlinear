import { describe, it, expect } from "vitest";
import { md5Hex } from "../translator/md5";

describe("md5Hex (RFC 1321 test vectors)", () => {
  it("hashes the empty string", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("hashes single-character 'a'", () => {
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
  });

  it("hashes 'abc'", () => {
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("hashes 'message digest'", () => {
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
  });

  it("hashes the alphabet", () => {
    expect(md5Hex("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
  });

  it("hashes alnum (62 chars) — spans exactly one 64-byte block boundary", () => {
    expect(md5Hex("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")).toBe(
      "d174ab98d277d9f5a5611c2c9f419d9f"
    );
  });

  it("hashes eight repeated digit-runs (80 chars) — spans two blocks", () => {
    expect(
      md5Hex("12345678901234567890123456789012345678901234567890123456789012345678901234567890")
    ).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });
});

describe("md5Hex (UTF-8)", () => {
  it("hashes CJK characters as their UTF-8 byte sequence", () => {
    // md5(0xe4 0xbd 0xa0 0xe5 0xa5 0xbd) = 7eca689f0d3389d9dea66ae112e5cfd7
    expect(md5Hex("你好")).toBe("7eca689f0d3389d9dea66ae112e5cfd7");
  });
});

describe("md5Hex (Baidu docs canonical example)", () => {
  // From the Baidu translate API docs: appid+q+salt+appkey = "2015063000000001apple654781234567890"
  // then md5(...) must equal "a1a7461d92e5194c5cae3182b5b24de1".
  it("matches the docs' worked example (regression guard for the sign)", () => {
    expect(md5Hex("2015063000000001apple654781234567890")).toBe(
      "a1a7461d92e5194c5cae3182b5b24de1"
    );
  });
});
