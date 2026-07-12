/**
 * SHA-256 hex over the UTF-8 encoding of a string, via WebCrypto.
 *
 * `crypto.subtle` exists in the Obsidian desktop renderer, the mobile
 * webview, and Node ≥ 18 (vitest) — no Node `crypto` import needed. Async is
 * fine: the only consumer signs translation requests inside an async flow.
 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
