import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-logic suites only. The plugin's design keeps DOM/network out of the
    // tested import graph, so a plain Node environment is sufficient — and tests
    // must never pull in the `obsidian` runtime (types-only package).
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
