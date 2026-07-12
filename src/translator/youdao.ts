/**
 * Youdao backend (traditional MT, 文本翻译 API) — pure builder + parser plus
 * a provider class with an injected {@link HttpClient}. No `obsidian`, no
 * network (SHA-256 comes from WebCrypto via core/sha256).
 *
 * Protocol quirks this file encodes:
 *   - v3 signature: sha256(appKey + input + salt + curtime + appSecret),
 *     where `input` truncates long text to first10 + length + last10 in
 *     UTF-16 code units (matches the official demos).
 *   - Errors arrive as HTTP 200 with a non-"0" `errorCode` body.
 *   - One `q` per request; the effective limit is a console-assigned per-app
 *     QPS quota (low by default; exceeding it returns 411/412), paced by the
 *     pool via the service preset, so translate() must stay one-HTTP-call.
 */
import {
  HttpClient,
  HttpRequestSpec,
  HttpResponseLike,
  TranslationProvider,
  TranslationError,
  AuthError,
  RateLimitError,
  MalformedResponseError,
  parseJsonBody,
  formEncode,
} from "./provider";
import { mapTargetLang } from "./langCodes";
import { sha256Hex } from "../core/sha256";

export const YOUDAO_ENDPOINT = "https://openapi.youdao.com/api";

/** One segment per request (see module docs). */
export const YOUDAO_MAX_SEGMENTS = 1;
/** `q` is capped at 5000 chars; leave headroom. */
export const YOUDAO_MAX_CHARS = 4500;

export interface YoudaoConfig {
  appKey: string;
  appSecret: string;
  targetLang: string;
}

/** v3 sign input: q itself when short, else first10 + UTF-16 length + last10. */
export function youdaoSignInput(q: string): string {
  return q.length <= 20 ? q : q.slice(0, 10) + q.length + q.slice(-10);
}

export async function buildYoudaoRequest(
  segment: string,
  cfg: YoudaoConfig,
  salt: string,
  curtime: string
): Promise<HttpRequestSpec> {
  const appKey = cfg.appKey.trim();
  const sign = await sha256Hex(
    appKey + youdaoSignInput(segment) + salt + curtime + cfg.appSecret.trim()
  );
  return {
    url: YOUDAO_ENDPOINT,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode({
      q: segment,
      from: "auto",
      to: mapTargetLang("youdao", cfg.targetLang),
      appKey,
      salt,
      sign,
      signType: "v3",
      curtime,
    }),
  };
}

/**
 * Parse one response into the segment's translation. Error codes (returned
 * with HTTP 200): 108 (invalid appKey) / 202 (signature) auth · 411/412 rate
 * limit · anything else a non-retryable TranslationError.
 */
export function parseYoudaoResponse(res: HttpResponseLike): string {
  if (res.status < 200 || res.status >= 300) {
    throw new MalformedResponseError(`HTTP ${res.status}`);
  }
  const payload = parseJsonBody(res) as { errorCode?: unknown; translation?: unknown };

  const code = String(payload?.errorCode ?? "");
  if (code !== "0") {
    if (code === "108" || code === "202") {
      throw new AuthError(`The service rejected the credentials (error ${code}).`);
    }
    if (code === "411" || code === "412") {
      throw new RateLimitError(`Rate limited by the translation API (error ${code}).`);
    }
    throw new TranslationError(`Translation API error ${code}.`);
  }

  const rows = payload?.translation;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new MalformedResponseError("Missing translation array.");
  }
  for (const row of rows) {
    if (typeof row !== "string") throw new MalformedResponseError("Non-string translation entry.");
  }
  return (rows as string[]).join("\n");
}

export interface YoudaoProviderDeps {
  config: YoudaoConfig;
  http: HttpClient;
  /** Unix-ms clock — injectable so tests can pin curtime in the signature. */
  now?: () => number;
  /** Salt source — injectable so tests can pin the signature. */
  random?: () => string;
}

const defaultRandom = (): string => Math.random().toString(36).slice(2, 12);

export class YoudaoProvider implements TranslationProvider {
  readonly maxSegmentsPerRequest = YOUDAO_MAX_SEGMENTS;
  readonly maxCharsPerRequest = YOUDAO_MAX_CHARS;

  private readonly config: YoudaoConfig;
  private readonly http: HttpClient;
  private readonly now: () => number;
  private readonly random: () => string;

  constructor(deps: YoudaoProviderDeps) {
    this.config = deps.config;
    this.http = deps.http;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? defaultRandom;
  }

  async translate(segments: string[]): Promise<string[]> {
    if (segments.length === 0) return [];
    // See BaiduProvider: one HTTP request per translate() call, always.
    if (segments.length > 1) {
      throw new TranslationError(
        `This service takes one segment per request (got ${segments.length}).`
      );
    }
    const curtime = String(Math.floor(this.now() / 1000));
    const req = await buildYoudaoRequest(segments[0], this.config, this.random(), curtime);
    return [parseYoudaoResponse(await this.http(req))];
  }
}
