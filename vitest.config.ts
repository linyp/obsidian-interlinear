import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // The published `obsidian` package is types-only at test runtime. Shell
    // suites mock this resolvable stub while production still externalizes the
    // real runtime supplied by Obsidian.
    alias: {
      obsidian: fileURLToPath(new URL("./src/__tests__/obsidianRuntimeStub.ts", import.meta.url)),
    },
  },
  test: {
    // Pure suites use Node; DOM adapter suites opt into happy-dom per file.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
