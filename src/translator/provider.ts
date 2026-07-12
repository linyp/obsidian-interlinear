/**
 * Translation provider abstraction + transport seam + typed errors.
 *
 * Pure: no `obsidian`, no DOM, no network. The actual HTTP call is injected as
 * an {@link HttpClient}, so the provider's request-building and response-parsing
 * are unit-testable with a fake client (the real `requestUrl` adapter lands in
 * Milestone 3). Errors carry a `retryable` flag so the rate limiter can decide
 * backoff without importing these classes.
 */

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  targetLang: string;
  /** Optional user-provided instructions appended to the system prompt. */
  customInstructions?: string;
}

export interface HttpRequestSpec {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** Minimal shape of an Obsidian `requestUrl` response (redeclared locally to
 *  keep this module free of any `obsidian` import). */
export interface HttpResponseLike {
  status: number;
  text: string;
  json?: unknown;
  headers?: Record<string, string>;
}

export type HttpClient = (req: HttpRequestSpec) => Promise<HttpResponseLike>;

export interface TranslationProvider {
  /** Translate N source segments, returning N translations in the same order. */
  translate(segments: string[]): Promise<string[]>;
  /**
   * Hard per-request caps for services with strict batch limits. The
   * controller clamps its chunking to these BEFORE calling translate(), so a
   * provider never has to loop internally (which would bypass the rate
   * limiter's request spacing). Absent = unbounded (LLM batching applies).
   */
  readonly maxSegmentsPerRequest?: number;
  readonly maxCharsPerRequest?: number;
}

// --- shared HTTP helpers (used by every provider's pure parser) -------------

/** Case-insensitive header lookup (requestUrl header casing is not guaranteed). */
export function headerValue(
  headers: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/** Parse a `Retry-After` (delta-seconds) header into milliseconds, if present. */
export function retryAfterMs(headers: Record<string, string> | undefined): number | undefined {
  const raw = headerValue(headers, "Retry-After");
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/** JSON body of a response (`res.json` if the transport pre-parsed it, else
 *  `res.text`), or a typed error if the body isn't valid JSON. */
export function parseJsonBody(res: HttpResponseLike): unknown {
  if (res.json !== undefined && res.json !== null) return res.json;
  try {
    return JSON.parse(res.text);
  } catch {
    throw new MalformedResponseError("Response body is not valid JSON.");
  }
}

/** application/x-www-form-urlencoded encoding for form-POST services. */
export function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export class TranslationError extends Error {
  /** Whether a retry could plausibly succeed. Overridden by subclasses. */
  readonly retryable: boolean = false;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Preserve `instanceof` across transpilation/bundling targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthError extends TranslationError {
  readonly retryable = false;
  constructor(message = "Authentication failed — check your API key.") {
    super(message);
  }
}

export class RateLimitError extends TranslationError {
  readonly retryable = true;
  readonly retryAfterMs?: number;
  constructor(message = "Rate limited by the translation API.", retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

export class MalformedResponseError extends TranslationError {
  readonly retryable = false;
  constructor(message = "Malformed response from the translation API.") {
    super(message);
  }
}

export class SegmentCountMismatchError extends TranslationError {
  readonly retryable = false;
  readonly expected: number;
  readonly got: number;
  constructor(expected: number, got: number) {
    super(`Segment count mismatch: expected ${expected}, got ${got}.`);
    this.expected = expected;
    this.got = got;
  }
}
