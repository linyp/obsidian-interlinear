import { TranslationCache } from "./cache";

export interface CacheFileAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface CachePersistenceOptions {
  cache: TranslationCache;
  adapter: CacheFileAdapter;
  path: string;
  enabled: () => boolean;
  onError?: (message: string, error: unknown) => void;
}

/** Persistent-cache file lifecycle, isolated from the Obsidian Plugin shell. */
export class TranslationCachePersistence {
  private readonly cache: TranslationCache;
  private readonly adapter: CacheFileAdapter;
  private readonly path: string;
  private readonly enabled: () => boolean;
  private readonly onError: (message: string, error: unknown) => void;

  constructor(options: CachePersistenceOptions) {
    this.cache = options.cache;
    this.adapter = options.adapter;
    this.path = options.path;
    this.enabled = options.enabled;
    this.onError = options.onError ?? ((message, error) => console.error(message, error));
  }

  async load(): Promise<void> {
    if (!this.enabled()) return;
    try {
      if (!(await this.adapter.exists(this.path))) return;
      this.cache.hydrate(await this.adapter.read(this.path));
    } catch (error) {
      this.onError("Interlinear: failed to load translation cache", error);
    }
  }

  async flush(): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.adapter.write(this.path, this.cache.serialize());
    } catch (error) {
      this.onError("Interlinear: failed to save translation cache", error);
    }
  }

  async removeFile(): Promise<void> {
    try {
      if (await this.adapter.exists(this.path)) await this.adapter.remove(this.path);
    } catch (error) {
      this.onError("Interlinear: failed to remove translation cache file", error);
    }
  }

  async onEnabledChanged(): Promise<void> {
    if (this.enabled()) await this.flush();
    else await this.removeFile();
  }
}
