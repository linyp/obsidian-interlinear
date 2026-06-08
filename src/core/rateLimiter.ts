/**
 * Bounded-concurrency task pool with request spacing + retry/backoff.
 *
 * Pure and decoupled: `isRetryable`/`backoff` are pure; `runPool` takes
 * injectable `sleep`/`now` so timing logic is testable without real time.
 * It never imports the provider — it only reads an error's `retryable` flag,
 * treating unknown errors (e.g. network failures) as retryable.
 */

/** An error is retryable if it explicitly says so; unknown errors default to true. */
export function isRetryable(error: unknown): boolean {
  if (error && typeof error === "object" && "retryable" in error) {
    return (error as { retryable?: unknown }).retryable === true;
  }
  return true;
}

export function shouldRetry(error: unknown, attempt: number, maxRetries: number): boolean {
  return attempt < maxRetries && isRetryable(error);
}

/** Deterministic exponential backoff (no jitter, so it's testable). */
export function backoff(attempt: number, baseMs = 500, capMs = 8000): number {
  return Math.min(capMs, baseMs * 2 ** attempt);
}

export interface PoolOptions {
  /** Max tasks in flight at once. */
  concurrency: number;
  /** Minimum spacing between task starts (ms). */
  minIntervalMs: number;
  /** Retries after the initial attempt. */
  maxRetries: number;
  baseBackoffMs?: number;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; defaults to Date.now. */
  now?: () => number;
}

export type PoolResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run all tasks with bounded concurrency, start spacing, and retry/backoff.
 * Results are returned in the SAME order as the input tasks. A task that
 * ultimately fails yields `{ ok: false, error }` rather than rejecting the pool.
 */
export async function runPool<T>(
  tasks: Array<() => Promise<T>>,
  opts: PoolOptions
): Promise<PoolResult<T>[]> {
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const concurrency = Math.max(1, opts.concurrency);
  const results: PoolResult<T>[] = new Array(tasks.length);

  let nextIndex = 0;
  let lastStart = Number.NEGATIVE_INFINITY;

  async function runOne(taskIndex: number): Promise<void> {
    if (opts.minIntervalMs > 0) {
      const wait = lastStart + opts.minIntervalMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastStart = now();

    let attempt = 0;
    for (;;) {
      try {
        results[taskIndex] = { ok: true, value: await tasks[taskIndex]() };
        return;
      } catch (error) {
        if (shouldRetry(error, attempt, opts.maxRetries)) {
          await sleep(backoff(attempt, opts.baseBackoffMs));
          attempt++;
          continue;
        }
        results[taskIndex] = { ok: false, error };
        return;
      }
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= tasks.length) return;
      await runOne(i);
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < workerCount; w++) workers.push(worker());
  await Promise.all(workers);

  return results;
}
