import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function productionTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : productionTypeScriptFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("production architecture contracts", () => {
  const source = productionTypeScriptFiles(SOURCE_ROOT)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  it("never uses fetch instead of the Obsidian requestUrl adapter", () => {
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it("never invokes Vault note-mutation APIs", () => {
    // Plugin-owned data.json/cache.json writes go through saveData or the Vault
    // adapter; note bodies must never go through the high-level Vault mutators.
    expect(source).not.toMatch(/\.vault\.(?:modify|process|create|delete|rename)\s*\(/);
  });
});
