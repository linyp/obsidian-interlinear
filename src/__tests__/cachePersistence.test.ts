import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationCache } from "../translator/cache";
import {
  TranslationCachePersistence,
  type CacheFileAdapter,
} from "../translator/cachePersistence";

function harness(enabled = true): {
  cache: TranslationCache;
  adapter: CacheFileAdapter;
  persistence: TranslationCachePersistence;
  files: Map<string, string>;
  setEnabled(value: boolean): void;
  onError: ReturnType<typeof vi.fn>;
} {
  let active = enabled;
  const files = new Map<string, string>();
  const adapter: CacheFileAdapter = {
    exists: vi.fn(async (path) => files.has(path)),
    read: vi.fn(async (path) => files.get(path) ?? ""),
    write: vi.fn(async (path, data) => {
      files.set(path, data);
    }),
    remove: vi.fn(async (path) => {
      files.delete(path);
    }),
  };
  const cache = new TranslationCache();
  const onError = vi.fn();
  return {
    cache,
    adapter,
    files,
    onError,
    persistence: new TranslationCachePersistence({
      cache,
      adapter,
      path: "plugin/cache.json",
      enabled: () => active,
      onError,
    }),
    setEnabled(value) {
      active = value;
    },
  };
}

describe("TranslationCachePersistence", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads an existing cache only when persistence is enabled", async () => {
    const source = new TranslationCache();
    source.set("Hello", "model", "zh-CN", "你好");
    const h = harness();
    h.files.set("plugin/cache.json", source.serialize());

    await h.persistence.load();
    expect(h.cache.get("Hello", "model", "zh-CN")).toBe("你好");

    const disabled = harness(false);
    disabled.files.set("plugin/cache.json", source.serialize());
    await disabled.persistence.load();
    expect(disabled.adapter.exists).not.toHaveBeenCalled();
  });

  it("flushes serialized cache and removes the file when disabled", async () => {
    const h = harness();
    h.cache.set("Hello", "model", "zh-CN", "你好");

    await h.persistence.flush();
    expect(h.files.get("plugin/cache.json")).toBe(h.cache.serialize());

    h.setEnabled(false);
    await h.persistence.onEnabledChanged();
    expect(h.files.has("plugin/cache.json")).toBe(false);
  });

  it("writes current in-memory content when persistence is enabled", async () => {
    const h = harness(false);
    h.cache.set("Hello", "model", "zh-CN", "你好");
    h.setEnabled(true);

    await h.persistence.onEnabledChanged();
    expect(h.files.get("plugin/cache.json")).toBe(h.cache.serialize());
  });

  it("contains adapter failures and reports which operation failed", async () => {
    const h = harness();
    const failure = new Error("disk unavailable");
    vi.mocked(h.adapter.exists).mockRejectedValueOnce(failure);

    await expect(h.persistence.load()).resolves.toBeUndefined();
    expect(h.onError).toHaveBeenCalledWith(
      "Interlinear: failed to load translation cache",
      failure
    );
  });
});
