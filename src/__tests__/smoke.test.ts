import { describe, it, expect } from "vitest";

// Milestone 1 smoke test: proves the Vitest rig executes pure TypeScript
// without pulling in the `obsidian` runtime. Real pure-logic suites
// (hash, segmentation, blockRules, deepseek, cache, rateLimiter) land in Milestone 2.
describe("vitest rig", () => {
  it("runs pure TypeScript modules", () => {
    expect(2 ** 8).toBe(256);
  });
});
