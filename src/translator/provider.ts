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
