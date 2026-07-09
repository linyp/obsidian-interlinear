/**
 * Baidu General Translate — PURE parts + provider.
 *
 * Wire endpoint: `POST https://fanyi-api.baidu.com/api/trans/vip/translate`
 * with `application/x-www-form-urlencoded`. Different protocol from the
 * OpenAI-compatible endpoints, so this lives alongside deepseek.ts as a peer.
 *
 * How the reused {@link ProviderConfig} maps to Baidu:
 *   - config.apiKey             = Baidu API secret (密钥)
 *   - config.baseUrl            = Baidu APP ID (appid) — repurposed field
 *   - config.model              = IGNORED (Baidu has no such wire concept)
 *   - config.customInstructions = IGNORED (no system prompt)
 *   - config.targetLang         = BCP-47 code, mapped to Baidu's codes
 *
 * Batching contract: N source segments are joined with `\n` into `q`; the API
 * returns a `trans_result` entry per line. Each source segment may itself hold
 * newlines, so we track a per-segment "line count" and regroup accordingly. A
 * mismatch throws {@link SegmentCountMismatchError}, letting the provider fall
 * back to per-segment translation (mirroring the DeepSeek provider's design).
 */
import {
  ProviderConfig,
  HttpClient,
  HttpRequestSpec,
  HttpResponseLike,
  TranslationProvider,
  AuthError,
  RateLimitError,
  MalformedResponseError,
  SegmentCountMismatchError,
  TranslationError,
} from "./provider";
import { md5Hex } from "./md5";

export const BAIDU_ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";

/**
 * BCP-47 target language -> Baidu language code.
 * Baidu uses its own codes (e.g. `jp` for Japanese, `fra` for French). If a
 * code isn't listed we pass the base subtag through — many codes are shared
 * (en, de, it, ru, pl, nl, th, ...), and unknown-target errors then surface
 * as Baidu's own 58001 which we map to a MalformedResponseError.
 */
const BCP47_TO_BAIDU: Record<string, string> = {
  // Chinese
  "zh": "zh",
  "zh-cn": "zh",
  "zh-hans": "zh",
  "zh-tw": "cht",
  "zh-hk": "cht",
  "zh-hant": "cht",
  // Japanese / Korean
  "ja": "jp",
  "ko": "kor",
  // European (Baidu's 3-letter shorthand for a few)
  "fr": "fra",
  "es": "spa",
  "ar": "ara",
  "bg": "bul",
  "et": "est",
  "da": "dan",
  "fi": "fin",
  "ro": "rom",
  "sl": "slo",
  "sv": "swe",
  // Portuguese / Vietnamese
  "pt": "pt",
  "pt-br": "pt",
  "pt-pt": "pt",
  "vi": "vie",
};

/** Map a BCP-47 code (case-insensitive) to Baidu's language code, best-effort. */
export function toBaiduLangCode(bcp47: string): string {
  const norm = bcp47.trim().toLowerCase();
  if (norm in BCP47_TO_BAIDU) return BCP47_TO_BAIDU[norm];
  const base = norm.split(/[-_]/)[0];
  if (base in BCP47_TO_BAIDU) return BCP47_TO_BAIDU[base];
  return base;
}

/**
 * Build the sign — `md5(appid + q + salt + secret)`. `q` here MUST be the raw
 * UTF-8 text, NOT URL-encoded — see docs §54001 troubleshooting: pre-encoding
 * `q` before signing is the single most common cause of 54001 sign errors.
 */
export function buildBaiduSign(appid: string, q: string, salt: string, secret: string): string {
  return md5Hex(appid + q + salt + secret);
}

/** Salt: a numeric-ish string. Any letters/digits string works per the docs. */
export function makeSalt(now: () => number = Date.now, rand: () => number = Math.random): string {
  return `${now()}${Math.floor(rand() * 1e6)}`;
}

/**
 * URL-encode a form value (application/x-www-form-urlencoded uses `+` for
 * space; encodeURIComponent's `%20` is a legal but non-canonical variant).
 */
function formEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export interface BaiduRequestOptions {
  /** Injected for tests; a fresh random salt is generated per request otherwise. */
  salt?: string;
}

/**
 * Build the Baidu translate POST request. `q` may contain `\n` — each line
 * yields a separate `trans_result` entry in the response.
 */
export function buildBaiduRequest(
  q: string,
  cfg: ProviderConfig,
  opts: BaiduRequestOptions = {}
): HttpRequestSpec {
  const appid = cfg.baseUrl.trim();
  const secret = cfg.apiKey;
  const to = toBaiduLangCode(cfg.targetLang);
  const salt = opts.salt ?? makeSalt();
  const sign = buildBaiduSign(appid, q, salt, secret);

  // Order matches the docs example. All values are URL-encoded ONLY here; the
  // sign was computed above on the raw `q` per the 54001 troubleshooting rules.
  const form: Array<[string, string]> = [
    ["q", q],
    ["from", "auto"],
    ["to", to],
    ["appid", appid],
    ["salt", salt],
    ["sign", sign],
  ];
  const body = form.map(([k, v]) => `${k}=${formEncode(v)}`).join("&");
  return {
    url: BAIDU_ENDPOINT,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  };
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Pack multi-line source segments into one `q` and record how many lines each
 * contributed (empty lines count too — Baidu returns one trans_result entry
 * per input line, so the regroup must include them). Returns the joined `q`
 * plus the per-segment line counts for {@link unpackBaiduTransResult}.
 */
export function packBaiduBatch(segments: string[]): { q: string; lineCounts: number[] } {
  const lineCounts: number[] = [];
  const allLines: string[] = [];
  for (const s of segments) {
    const lines = splitLines(s);
    lineCounts.push(lines.length);
    allLines.push(...lines);
  }
  return { q: allLines.join("\n"), lineCounts };
}

/**
 * Regroup a flat `trans_result` `dst` stream back into per-segment translations
 * using the recorded per-segment line counts. Throws
 * {@link SegmentCountMismatchError} when the totals disagree — the caller
 * (BaiduProvider) then falls back to one request per segment.
 */
export function unpackBaiduTransResult(dsts: string[], lineCounts: number[]): string[] {
  const total = lineCounts.reduce((a, b) => a + b, 0);
  if (dsts.length !== total) {
    throw new SegmentCountMismatchError(total, dsts.length);
  }
  const out: string[] = [];
  let pos = 0;
  for (const n of lineCounts) {
    out.push(dsts.slice(pos, pos + n).join("\n"));
    pos += n;
  }
  return out;
}

// Baidu error_code -> typed TranslationError. The rate limiter reads `retryable`
// off the returned error and honors `retryAfterMs` when present; here Baidu
// gives us no Retry-After hint, so retryable RateLimitErrors just use the
// pool's exponential backoff.
function mapBaiduErrorCode(code: string, msg: string): TranslationError {
  switch (code) {
    // Auth / configuration — user must fix credentials, endpoint config, or IP.
    case "52003": // unauthorized user (bad appid / service off)
    case "54001": // sign error (bad secret or bad request construction)
    case "54004": // insufficient balance
    case "58000": // illegal client IP
    case "58002": // service currently off
    case "58003": // IP banned
    case "90107": // auth not passed
      return new AuthError(`Baidu ${code}: ${msg || "authentication/config error"}`);

    // Retryable transient errors.
    case "52001": // request timeout
    case "52002": // system error ("请重试")
      return new RateLimitError(`Baidu ${code}: ${msg || "transient error, retry"}`);
    case "54003": // rate limited (QPS)
    case "54005": // long-query rate limited (3s cooldown)
      return new RateLimitError(`Baidu ${code}: ${msg || "rate limited"}`);

    // Bad request / content — not worth retrying identically.
    case "54000": // missing required param — never expected here
    case "58001": // target language not supported for tier
    case "20003": // safety risk (blocked content)
    default:
      return new MalformedResponseError(`Baidu ${code}: ${msg || "unexpected response"}`);
  }
}

interface BaiduSuccessBody {
  trans_result?: Array<{ src?: unknown; dst?: unknown }>;
  error_code?: unknown;
  error_msg?: unknown;
}

// The docs say error_code appears only on error, but 52000 = "success" also
// exists. Treat "0" and "52000" as success — anything else present is an error.
function isSuccessCode(code: unknown): boolean {
  if (code === undefined) return true;
  const s = String(code);
  return s === "0" || s === "52000";
}

/**
 * Parse a Baidu translate response into a flat list of translated lines (each
 * corresponding to one input line of `q`). The caller regroups these into per-
 * segment translations using {@link unpackBaiduTransResult}.
 */
export function parseBaiduResponse(res: HttpResponseLike): string[] {
  if (res.status < 200 || res.status >= 300) {
    throw new MalformedResponseError(`HTTP ${res.status}`);
  }
  let payload: unknown = res.json;
  if (payload === undefined || payload === null) {
    try {
      payload = JSON.parse(res.text);
    } catch {
      throw new MalformedResponseError("Response body is not valid JSON.");
    }
  }
  if (!payload || typeof payload !== "object") {
    throw new MalformedResponseError("Response body is not a JSON object.");
  }
  const body = payload as BaiduSuccessBody;
  if (!isSuccessCode(body.error_code)) {
    const code = String(body.error_code);
    const msg = typeof body.error_msg === "string" ? body.error_msg : "";
    throw mapBaiduErrorCode(code, msg);
  }
  if (!Array.isArray(body.trans_result)) {
    throw new MalformedResponseError("Missing trans_result array.");
  }
  const out: string[] = [];
  for (const entry of body.trans_result) {
    const dst = entry && typeof entry === "object" ? (entry as { dst?: unknown }).dst : undefined;
    if (typeof dst !== "string") {
      throw new MalformedResponseError("A trans_result entry is missing its dst field.");
    }
    out.push(dst);
  }
  return out;
}

export interface BaiduProviderDeps {
  config: ProviderConfig;
  /** Injected transport — `obsidianRequestUrlClient` in production, a fake in tests. */
  http: HttpClient;
  /** Injected for tests; defaults to {@link makeSalt}. */
  salt?: () => string;
}

/**
 * Baidu translate provider. Composes the pure request builder + parser with an
 * injected {@link HttpClient}. Presents the same {@link TranslationProvider}
 * surface as the DeepSeek provider, so the UI/controller flows are unchanged.
 * No `obsidian`, no DOM — the real `requestUrl` transport is wired by callers.
 */
export class BaiduProvider implements TranslationProvider {
  private readonly config: ProviderConfig;
  private readonly http: HttpClient;
  private readonly saltFn: () => string;

  constructor(deps: BaiduProviderDeps) {
    this.config = deps.config;
    this.http = deps.http;
    this.saltFn = deps.salt ?? makeSalt;
  }

  async translate(segments: string[]): Promise<string[]> {
    if (segments.length === 0) return [];
    try {
      const { q, lineCounts } = packBaiduBatch(segments);
      const res = await this.http(buildBaiduRequest(q, this.config, { salt: this.saltFn() }));
      const dsts = parseBaiduResponse(res);
      return unpackBaiduTransResult(dsts, lineCounts);
    } catch (err) {
      // Only a broken batch contract triggers the per-segment fallback; auth/
      // rate-limit/malformed errors propagate to the pool.
      if (err instanceof SegmentCountMismatchError && segments.length > 1) {
        return this.translateOneByOne(segments);
      }
      throw err;
    }
  }

  /** Per-segment fallback: one request each, so every result maps 1:1. */
  private async translateOneByOne(segments: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const seg of segments) {
      const { q, lineCounts } = packBaiduBatch([seg]);
      const res = await this.http(buildBaiduRequest(q, this.config, { salt: this.saltFn() }));
      const dsts = parseBaiduResponse(res);
      out.push(unpackBaiduTransResult(dsts, lineCounts)[0]);
    }
    return out;
  }
}
