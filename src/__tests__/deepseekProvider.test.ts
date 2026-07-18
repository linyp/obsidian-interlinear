import { describe, it, expect, vi } from "vitest";
import { DeepSeekProvider } from "../translator/deepseek";
import {
  ProviderConfig,
  HttpRequestSpec,
  HttpResponseLike,
  AuthError,
  RateLimitError,
  SegmentCountMismatchError,
} from "../translator/provider";

const cfg: ProviderConfig = {
  apiKey: "k",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  targetLang: "zh-CN",
};

function batchResponse(translations: string[]): HttpResponseLike {
  const content = translations.map((t, i) => `<<<SEG ${i + 1}>>>\n${t}`).join("\n\n");
  const payload = { choices: [{ message: { content } }] };
  return { status: 200, text: JSON.stringify(payload), json: payload };
}

describe("DeepSeekProvider.translate", () => {
  it("returns [] for no segments without calling the client", async () => {
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> =>
      batchResponse([])
    );
    const provider = new DeepSeekProvider({ config: cfg, http });
    expect(await provider.translate([])).toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });

  it("translates a batch in a single request", async () => {
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> =>
      batchResponse(["你好", "世界"])
    );
    const provider = new DeepSeekProvider({ config: cfg, http });
    expect(await provider.translate(["hello", "world"])).toEqual(["你好", "世界"]);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("propagates a short batch contract failure after exactly one request", async () => {
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> =>
      batchResponse(["only-one"])
    );
    const provider = new DeepSeekProvider({ config: cfg, http });

    await expect(provider.translate(["hello", "world"])).rejects.toBeInstanceOf(
      SegmentCountMismatchError
    );
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("propagates non-batch errors (e.g. auth) without falling back", async () => {
    const http = vi.fn(
      async (_req: HttpRequestSpec): Promise<HttpResponseLike> => ({ status: 401, text: "" })
    );
    const provider = new DeepSeekProvider({ config: cfg, http });
    await expect(provider.translate(["hello", "world"])).rejects.toBeInstanceOf(AuthError);
    expect(http).toHaveBeenCalledTimes(1); // no per-segment retries on auth failure
  });

  it("propagates an oversized batch contract failure after exactly one request", async () => {
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> =>
      batchResponse(["x", "y", "z"])
    );
    const provider = new DeepSeekProvider({ config: cfg, http });
    await expect(provider.translate(["hello", "world"])).rejects.toBeInstanceOf(
      SegmentCountMismatchError
    );
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("propagates a rate-limit error so the pool can retry", async () => {
    const http = vi.fn(
      async (_req: HttpRequestSpec): Promise<HttpResponseLike> => ({ status: 429, text: "" })
    );
    const provider = new DeepSeekProvider({ config: cfg, http });
    await expect(provider.translate(["a", "b"])).rejects.toBeInstanceOf(RateLimitError);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("sends the packed batch with numbered markers", async () => {
    const http = vi.fn(async (req: HttpRequestSpec): Promise<HttpResponseLike> => {
      const body = JSON.parse(req.body);
      expect(body.messages[1].content).toContain("<<<SEG 1>>>");
      expect(body.messages[1].content).toContain("<<<SEG 2>>>");
      return batchResponse(["A", "B"]);
    });
    const provider = new DeepSeekProvider({ config: cfg, http });
    await provider.translate(["a", "b"]);
    expect(http).toHaveBeenCalled();
  });
});
