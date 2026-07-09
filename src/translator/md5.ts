/**
 * MD5 (RFC 1321) — pure, dependency-free, UTF-8 aware.
 *
 * Needed for the Baidu translate `sign` parameter: `md5(appid + q + salt + secret)`
 * as a 32-char lowercase hex string. Node's `crypto` is not available in the
 * Obsidian renderer, and `SubtleCrypto` intentionally omits MD5 — so we ship a
 * small implementation instead of pulling in a dependency.
 *
 * SECURITY: MD5 is used ONLY for Baidu's non-cryptographic API signature.
 * Never use this hash for anything security-sensitive.
 */

// Per-round left-rotation amounts (RFC 1321 §3.4).
const S: ReadonlyArray<number> = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// Constants K[i] = floor(2^32 * abs(sin(i + 1))) (RFC 1321 §3.4, Table T).
const K: ReadonlyArray<number> = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

/** Rotate `x` left by `n` bits within 32-bit unsigned semantics. */
function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** UTF-8-encode `input` — matches Baidu's "UTF-8 encoded q" contract. */
function utf8Bytes(input: string): Uint8Array {
  // TextEncoder is available in Electron (Obsidian renderer) and Node 11+.
  return new TextEncoder().encode(input);
}

/** MD5 hash of a byte buffer, returned as 32-char lowercase hex. */
export function md5Bytes(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8;
  // Padding: 0x80, then zero bytes to fill (bytes.length + 9) up to a 64-byte
  // boundary, then 8 bytes of original bit length (little-endian).
  const paddedLen = ((bytes.length + 9 + 63) >>> 6) << 6;
  const buffer = new Uint8Array(paddedLen);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  // JS numbers are safe integers up to 2^53, so byte lengths up to ~1 PB fit
  // in the low 32-bits of the bit-length. High word stays 0 in practice.
  view.setUint32(paddedLen - 8, bitLength >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLength / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Array<number>(16);
  for (let block = 0; block < paddedLen; block += 64) {
    for (let i = 0; i < 16; i++) {
      M[i] = view.getUint32(block + i * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) & 15;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) & 15;
      }
      const sum = (A + F + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(sum, S[i])) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  return wordToLeHex(a0) + wordToLeHex(b0) + wordToLeHex(c0) + wordToLeHex(d0);
}

/** Encode a 32-bit word as 8 lowercase hex chars, LEAST-significant byte first. */
function wordToLeHex(word: number): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    const byte = (word >>> (i * 8)) & 0xff;
    out += (byte < 16 ? "0" : "") + byte.toString(16);
  }
  return out;
}

/** MD5 of a JavaScript string, UTF-8 encoded, as 32-char lowercase hex. */
export function md5Hex(input: string): string {
  return md5Bytes(utf8Bytes(input));
}
