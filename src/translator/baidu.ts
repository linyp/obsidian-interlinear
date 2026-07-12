/**
 * Baidu Translate backend (traditional MT, 通用翻译 API) — pure builder +
 * parser plus a provider class with an injected {@link HttpClient}. No
 * `obsidian`, no network.
 *
 * Protocol quirks this file encodes:
 *   - Form-POST with an MD5 signature: md5(appid + q + salt + secret), where
 *     `q` is the RAW text (signing the urlencoded form is the classic bug).
 *   - Errors arrive as HTTP 200 with an `error_code` body — check body first.
 *   - The API splits `q` per newline and returns one trans_result row per
 *     line, so a multi-line SEGMENT is reconstructed by joining `dst` rows
 *     with "\n". Batching multiple segments per request via newline-joining
 *     is NOT safe (segments may contain newlines), hence one segment per
 *     request; the QPS limit (10 on the verified free Advanced plan, 1
 *     unverified) is handled by the pool's spacing (see the service preset),
 *     so translate() must stay one-HTTP-call.
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
import { md5Hex } from "../core/md5";

export const BAIDU_ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";

/** One segment per request (see module docs). */
export const BAIDU_MAX_SEGMENTS = 1;
/** `q` is capped at 6000 BYTES; CJK is ≤3 bytes/char in UTF-8, so 1800 chars is safe. */
export const BAIDU_MAX_CHARS = 1800;

export interface BaiduConfig {
  appId: string;
  appSecret: string;
  targetLang: string;
}

export function buildBaiduRequest(
  segment: string,
  cfg: BaiduConfig,
  salt: string
): HttpRequestSpec {
  const appId = cfg.appId.trim();
  // Sign the RAW query text, before any url-encoding.
  const sign = md5Hex(appId + segment + salt + cfg.appSecret.trim());
  return {
    url: BAIDU_ENDPOINT,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode({
      q: segment,
      from: "auto",
      to: mapTargetLang("baidu", cfg.targetLang),
      appid: appId,
      salt,
      sign,
    }),
  };
}

/**
 * Parse one response into the segment's translation. Error codes (returned
 * with HTTP 200): 52003/54001 auth · 54003 rate limit · 54004 balance ·
 * 58001 language · 52001/52002 transient service errors (plain Error so the
 * pool's default-retryable path retries them).
 */
export function parseBaiduResponse(res: HttpResponseLike): string {
  if (res.status < 200 || res.status >= 300) {
    throw new MalformedResponseError(`HTTP ${res.status}`);
  }
  const payload = parseJsonBody(res) as {
    error_code?: unknown;
    error_msg?: unknown;
    trans_result?: unknown;
  };

  const rawCode = payload?.error_code;
  if (rawCode !== undefined && rawCode !== null) {
    const code = String(rawCode);
    const msg = typeof payload.error_msg === "string" ? payload.error_msg : "";
    switch (code) {
      case "52000": // documented success code — fall through to trans_result
        break;
      case "52003":
      case "54001":
        throw new AuthError(`The service rejected the credentials (${code}${msg ? `: ${msg}` : ""}).`);
      case "54003":
        throw new RateLimitError(`Rate limited by the translation API (${code}).`);
      case "54004":
        throw new TranslationError("Account balance is insufficient for this service.");
      case "58001":
        throw new TranslationError(`Target language not supported by this service (${code}).`);
      case "52001":
      case "52002":
        // Timeout / internal error — transient; a plain Error is retryable by
        // the pool's default (unknown errors retry).
        throw new Error(`Transient service error (${code}${msg ? `: ${msg}` : ""}).`);
      default:
        throw new TranslationError(`Translation API error ${code}${msg ? `: ${msg}` : ""}.`);
    }
  }

  const rows = payload?.trans_result;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new MalformedResponseError("Missing trans_result array.");
  }
  const lines: string[] = [];
  for (const row of rows) {
    const dst = (row as { dst?: unknown })?.dst;
    if (typeof dst !== "string") throw new MalformedResponseError("Missing trans_result[].dst.");
    lines.push(dst);
  }
  // The API split the single q per newline; joining restores the segment 1:1.
  return lines.join("\n");
}

export interface BaiduProviderDeps {
  config: BaiduConfig;
  http: HttpClient;
  /** Salt source — injectable so tests can pin the signature. */
  random?: () => string;
}

const defaultRandom = (): string => Math.random().toString(36).slice(2, 12);

export class BaiduProvider implements TranslationProvider {
  readonly maxSegmentsPerRequest = BAIDU_MAX_SEGMENTS;
  readonly maxCharsPerRequest = BAIDU_MAX_CHARS;

  private readonly config: BaiduConfig;
  private readonly http: HttpClient;
  private readonly random: () => string;

  constructor(deps: BaiduProviderDeps) {
    this.config = deps.config;
    this.http = deps.http;
    this.random = deps.random ?? defaultRandom;
  }

  async translate(segments: string[]): Promise<string[]> {
    if (segments.length === 0) return [];
    // The controller clamps chunking to maxSegmentsPerRequest, so this only
    // fires on a wiring bug. NEVER loop over segments here — each translate()
    // must be exactly one HTTP request or the pool's QPS spacing is bypassed.
    if (segments.length > 1) {
      throw new TranslationError(
        `This service takes one segment per request (got ${segments.length}).`
      );
    }
    const res = await this.http(buildBaiduRequest(segments[0], this.config, this.random()));
    return [parseBaiduResponse(res)];
  }
}
