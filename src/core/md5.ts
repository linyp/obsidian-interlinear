/**
 * MD5 over the UTF-8 encoding of a string — pure TS, dependency-free.
 *
 * Needed because one integrated translation service authenticates requests
 * with an MD5 signature. Node `crypto` is unavailable in the Obsidian
 * renderer (and on mobile), and `SubtleCrypto` doesn't expose MD5, so the
 * algorithm is implemented here. Non-security use (a wire-format checksum
 * the remote API mandates), consistent with the `hash.ts` philosophy — but
 * unlike FNV-1a this MUST be exact MD5, so the round constants are the
 * RFC 1321 table (hardcoded rather than derived from Math.sin, to rule out
 * any float-rounding divergence across JS engines).
 */

// Per-round left-rotate amounts (RFC 1321).
// prettier-ignore
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(abs(sin(i+1)) * 2^32) (RFC 1321 T table).
// prettier-ignore
const K = new Uint32Array([
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
]);

function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

/** Pad the UTF-8 message per RFC 1321: 0x80, zeros, 64-bit little-endian bit length. */
function padMessage(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8;
  const paddedLen = (Math.floor((bytes.length + 8) / 64) + 1) * 64;
  const out = new Uint8Array(paddedLen);
  out.set(bytes);
  out[bytes.length] = 0x80;
  const view = new DataView(out.buffer);
  // JS numbers hold the exact bit length far beyond any realistic input, but
  // split high/low manually since DataView has no 64-bit little-endian write
  // for plain numbers.
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);
  return out;
}

/** Lowercase hex MD5 digest of the UTF-8 encoding of `input`. */
export function md5Hex(input: string): string {
  const msg = padMessage(new TextEncoder().encode(input));
  const view = new DataView(msg.buffer);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;

  const m = new Uint32Array(16);
  for (let offset = 0; offset < msg.length; offset += 64) {
    for (let j = 0; j < 16; j++) m[j] = view.getUint32(offset + j * 4, true);

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      // Sums of a few uint32s stay exact in float64; truncate once at the end.
      const tmp = (a + (f >>> 0) + K[i] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(tmp, S[i])) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
  }

  // Digest = the four state words serialized little-endian.
  const digest = new Uint8Array(16);
  const dv = new DataView(digest.buffer);
  dv.setUint32(0, h0, true);
  dv.setUint32(4, h1, true);
  dv.setUint32(8, h2, true);
  dv.setUint32(12, h3, true);
  let hex = "";
  for (let i = 0; i < 16; i++) hex += digest[i].toString(16).padStart(2, "0");
  return hex;
}
