/**
 * DeepSeek backend — PURE parts only (Milestone 2):
 *   - `buildChatRequest`  : construct the OpenAI-compatible request spec
 *   - `parseChatResponse` : validate status, extract content, unpack segments
 *
 * The `DeepSeekProvider` class (composing these with an injected HttpClient +
 * per-segment fallback) and the `requestUrl` adapter arrive in Milestone 3.
 * No `obsidian`, no network here.
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
} from "./provider";
import { packBatch, unpackBatch } from "../core/segmentation";

export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_CHAT_PATH = "/chat/completions";

/** System prompt: constrain term consistency, markdown preservation, output-only,
 *  and the numbered-segment contract. `{{TARGET_LANG}}` is filled per request. */
const SYSTEM_PROMPT_TEMPLATE = [
  "You are a professional translator.",
  "Translate each input segment into {{TARGET_LANG}}.",
  "Keep terminology consistent across segments.",
  "Preserve the original markdown structure and inline formatting.",
  "Output ONLY the translation — no explanations, no commentary, no extra notes.",
  "The input is split into segments, each introduced by a line `<<<SEG k>>>`.",
  "Return the SAME number of segments in the SAME order, each introduced by its",
  "exact `<<<SEG k>>>` marker on its own line, followed by that segment's translation.",
].join("\n");

export function buildSystemPrompt(targetLang: string, customInstructions?: string): string {
  const base = SYSTEM_PROMPT_TEMPLATE.replace("{{TARGET_LANG}}", targetLang);
  const extra = customInstructions?.trim();
  if (!extra) return base;
  // Append AFTER the segment contract so user tweaks (glossary, tone, domain)
  // can't silently drop the `<<<SEG k>>>` rules the batching relies on.
  return `${base}\n\n## Additional instructions (user-provided)\n${extra}`;
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

/** Build the OpenAI-compatible `/chat/completions` request for a batch. */
export function buildChatRequest(segments: string[], cfg: ProviderConfig): HttpRequestSpec {
  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: buildSystemPrompt(cfg.targetLang, cfg.customInstructions) },
      { role: "user", content: packBatch(segments) },
    ],
    stream: false,
    temperature: 0,
  };
  return {
    url: joinUrl(cfg.baseUrl, DEEPSEEK_CHAT_PATH),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  };
}

/** Case-insensitive header lookup (requestUrl header casing is not guaranteed). */
function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/** Parse a `Retry-After` (delta-seconds) header into milliseconds, if present. */
function retryAfterMs(headers: Record<string, string> | undefined): number | undefined {
  const raw = headerValue(headers, "Retry-After");
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function extractContent(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const choices = (payload as { choices?: unknown }).choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const message = (choices[0] as { message?: unknown }).message;
      if (message && typeof message === "object") {
        const content = (message as { content?: unknown }).content;
        if (typeof content === "string") return content;
      }
    }
  }
  return undefined;
}

/**
 * Parse a DeepSeek chat response into `expectedCount` translations.
 * Throws typed errors the caller (provider/rate limiter) acts on:
 *   401/403 -> AuthError, 429 -> RateLimitError, other non-2xx/bad body ->
 *   MalformedResponseError, batch count/order mismatch -> SegmentCountMismatchError.
 *
 * For a single-segment request (e.g. the per-segment fallback) the model often
 * omits the marker; we then accept the whole content as the one translation.
 */
export function parseChatResponse(res: HttpResponseLike, expectedCount: number): string[] {
  if (res.status === 401 || res.status === 403) throw new AuthError();
  if (res.status === 429) throw new RateLimitError(undefined, retryAfterMs(res.headers));
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

  const content = extractContent(payload);
  if (content === undefined) {
    throw new MalformedResponseError("Missing choices[0].message.content.");
  }

  const unpacked = unpackBatch(content, expectedCount);
  if (!unpacked.ok) {
    if (expectedCount === 1) return [content.trim()];
    throw new SegmentCountMismatchError(expectedCount, unpacked.got);
  }
  return unpacked.segments;
}

export interface DeepSeekProviderDeps {
  config: ProviderConfig;
  /** Injected transport — `obsidianRequestUrlClient` in production, a fake in tests. */
  http: HttpClient;
}

/**
 * DeepSeek translation provider. Composes the pure request builder / response
 * parser with an injected {@link HttpClient}. No `obsidian`, no DOM — the real
 * `requestUrl` transport is wired in by the caller (see requestUrlClient.ts).
 */
export class DeepSeekProvider implements TranslationProvider {
  private readonly config: ProviderConfig;
  private readonly http: HttpClient;

  constructor(deps: DeepSeekProviderDeps) {
    this.config = deps.config;
    this.http = deps.http;
  }

  async translate(segments: string[]): Promise<string[]> {
    if (segments.length === 0) return [];
    try {
      const res = await this.http(buildChatRequest(segments, this.config));
      return parseChatResponse(res, segments.length);
    } catch (err) {
      // Only a broken batch contract triggers the fallback; auth/rate-limit/
      // malformed errors propagate to the caller (and the rate limiter).
      if (err instanceof SegmentCountMismatchError && segments.length > 1) {
        return this.translateOneByOne(segments);
      }
      throw err;
    }
  }

  /** Per-segment fallback: one request each, so every result maps 1:1. */
  private async translateOneByOne(segments: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const segment of segments) {
      const res = await this.http(buildChatRequest([segment], this.config));
      const [translated] = parseChatResponse(res, 1);
      out.push(translated);
    }
    return out;
  }
}
