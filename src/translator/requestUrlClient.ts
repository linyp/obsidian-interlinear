/**
 * Production {@link HttpClient} backed by Obsidian's `requestUrl`.
 *
 * `requestUrl` runs in the main process to bypass renderer CORS (the project
 * bans `fetch`). It lives in its own file — separate from the pure `deepseek.ts`
 * — so tests can import the provider without pulling in the `obsidian` runtime.
 *
 * `throw: false` keeps requestUrl from throwing on 4xx/5xx, so the pure
 * `parseChatResponse` can map status codes (401/429/…) to typed errors itself.
 */
import { requestUrl } from "obsidian";
import { HttpClient, HttpRequestSpec, HttpResponseLike } from "./provider";

export const obsidianRequestUrlClient: HttpClient = async (
  req: HttpRequestSpec
): Promise<HttpResponseLike> => {
  // SECURITY: never log `req` — req.headers carries the `Authorization: Bearer`
  // API key. requestUrl traffic is invisible to DevTools Network anyway.
  const res = await requestUrl({
    url: req.url,
    method: req.method,
    headers: req.headers,
    contentType: req.headers["Content-Type"],
    body: req.body,
    throw: false,
  });

  // `res.json` is a lazy getter that throws if the body is not valid JSON;
  // guard it so a non-JSON error body falls back to text parsing downstream.
  let json: unknown;
  try {
    json = res.json;
  } catch {
    json = undefined;
  }

  return { status: res.status, text: res.text, json, headers: res.headers };
};
