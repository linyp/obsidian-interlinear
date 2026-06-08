import { describe, it, expect, vi } from "vitest";
import { isRetryable, shouldRetry, backoff, runPool } from "../core/rateLimiter";
import { RateLimitError, AuthError } from "../translator/provider";

describe("isRetryable / shouldRetry", () => {
  it("retries rate-limit errors but not auth errors", () => {
    expect(isRetryable(new RateLimitError())).toBe(true);
    expect(isRetryable(new AuthError())).toBe(false);
  });

  it("treats unknown errors (e.g. network) as retryable", () => {
    expect(isRetryable(new Error("network down"))).toBe(true);
    expect(isRetryable("oops")).toBe(true);
  });

  it("stops retrying once attempt reaches maxRetries", () => {
    expect(shouldRetry(new RateLimitError(), 0, 3)).toBe(true);
    expect(shouldRetry(new RateLimitError(), 2, 3)).toBe(true);
    expect(shouldRetry(new RateLimitError(), 3, 3)).toBe(false);
    expect(shouldRetry(new AuthError(), 0, 3)).toBe(false);
  });
});

describe("backoff", () => {
  it("is exponential from the base", () => {
    expect(backoff(0, 500)).toBe(500);
    expect(backoff(1, 500)).toBe(1000);
    expect(backoff(2, 500)).toBe(2000);
  });

  it("is capped", () => {
    expect(backoff(20, 500, 8000)).toBe(8000);
  });
});

describe("runPool", () => {
  it("runs all tasks and returns results in input order", async () => {
    const sleep = vi.fn(async () => {});
    const tasks = [1, 2, 3].map((n) => async () => n * 10);
    const res = await runPool(tasks, { concurrency: 2, minIntervalMs: 0, maxRetries: 2, sleep });
    expect(res).toEqual([
      { ok: true, value: 10 },
      { ok: true, value: 20 },
      { ok: true, value: 30 },
    ]);
  });

  it("retries a rate-limited task then succeeds, sleeping with backoff", async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const task = async () => {
      calls++;
      if (calls === 1) throw new RateLimitError();
      return "done";
    };
    const res = await runPool([task], {
      concurrency: 1,
      minIntervalMs: 0,
      maxRetries: 3,
      baseBackoffMs: 100,
      sleep,
    });
    expect(res[0]).toEqual({ ok: true, value: "done" });
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledWith(100); // backoff(0, 100)
  });

  it("gives up after maxRetries on a persistent error", async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const task = async () => {
      calls++;
      throw new RateLimitError();
    };
    const res = await runPool([task], {
      concurrency: 1,
      minIntervalMs: 0,
      maxRetries: 2,
      baseBackoffMs: 50,
      sleep,
    });
    expect(res[0].ok).toBe(false);
    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 50); // backoff(0)
    expect(sleep).toHaveBeenNthCalledWith(2, 100); // backoff(1)
  });

  it("does not retry non-retryable errors", async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const task = async () => {
      calls++;
      throw new AuthError();
    };
    const res = await runPool([task], { concurrency: 1, minIntervalMs: 0, maxRetries: 3, sleep });
    expect(res[0].ok).toBe(false);
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("spaces task starts by minIntervalMs", async () => {
    const sleep = vi.fn(async () => {});
    const now = vi.fn(() => 1000); // frozen clock
    const tasks = [async () => "a", async () => "b"];
    await runPool(tasks, { concurrency: 1, minIntervalMs: 300, maxRetries: 0, sleep, now });
    // First task: no spacing (lastStart = -inf); second task waits the interval.
    expect(sleep).toHaveBeenCalledWith(300);
  });
});
