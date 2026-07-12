import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  YoudaoProvider,
  YoudaoConfig,
  youdaoSignInput,
  buildYoudaoRequest,
  parseYoudaoResponse,
  YOUDAO_ENDPOINT,
} from "../translator/youdao";
import {
  HttpRequestSpec,
  HttpResponseLike,
  TranslationError,
  AuthError,
  RateLimitError,
} from "../translator/provider";

const cfg: YoudaoConfig = { appKey: "app-key", appSecret: "app-secret", targetLang: "zh-CN" };

function okResponse(translations: string[]): HttpResponseLike {
  const payload = { errorCode: "0", translation: translations };
  return { status: 200, text: JSON.stringify(payload), json: payload };
}

function errorResponse(code: string): HttpResponseLike {
  const payload = { errorCode: code };
  return { status: 200, text: JSON.stringify(payload), json: payload };
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

describe("youdaoSignInput", () => {
  it("uses q verbatim up to 20 UTF-16 code units", () => {
    expect(youdaoSignInput("short text")).toBe("short text");
    expect(youdaoSignInput("x".repeat(20))).toBe("x".repeat(20));
  });

  it("truncates longer q to first10 + length + last10", () => {
    const q = "abcdefghij0123456789KLMNOPQRST"; // 30 chars
    expect(youdaoSignInput(q)).toBe("abcdefghij" + 30 + "KLMNOPQRST");
  });
});

describe("buildYoudaoRequest", () => {
  it("computes the exact v3 signature for a short q", async () => {
    const q = "hello";
    const req = await buildYoudaoRequest(q, cfg, "salt-1", "1690000000");
    const params = new URLSearchParams(req.body);
    expect(params.get("sign")).toBe(
      sha256(cfg.appKey + q + "salt-1" + "1690000000" + cfg.appSecret)
    );
    expect(params.get("signType")).toBe("v3");
    expect(params.get("curtime")).toBe("1690000000");
    expect(params.get("salt")).toBe("salt-1");
    expect(params.get("from")).toBe("auto");
    expect(params.get("to")).toBe("zh-CHS");
    expect(params.get("q")).toBe(q);
    expect(req.url).toBe(YOUDAO_ENDPOINT);
    expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("computes the exact v3 signature for a long q (truncated input, raw CJK)", async () => {
    const q = "这是一段超过二十个字符的很长的中文测试文本内容啊"; // > 20 chars
    const req = await buildYoudaoRequest(q, cfg, "s", "123");
    const input = q.slice(0, 10) + q.length + q.slice(-10);
    const params = new URLSearchParams(req.body);
    expect(params.get("sign")).toBe(sha256(cfg.appKey + input + "s" + "123" + cfg.appSecret));
  });
});

describe("parseYoudaoResponse", () => {
  it("joins the translation array", () => {
    expect(parseYoudaoResponse(okResponse(["你好"]))).toBe("你好");
    expect(parseYoudaoResponse(okResponse(["第一行", "第二行"]))).toBe("第一行\n第二行");
  });

  it("maps error codes carried in an HTTP-200 body", () => {
    expect(() => parseYoudaoResponse(errorResponse("108"))).toThrow(AuthError);
    expect(() => parseYoudaoResponse(errorResponse("202"))).toThrow(AuthError);
    expect(() => parseYoudaoResponse(errorResponse("411"))).toThrow(RateLimitError);
    expect(() => parseYoudaoResponse(errorResponse("412"))).toThrow(RateLimitError);
    expect(() => parseYoudaoResponse(errorResponse("401"))).toThrow(TranslationError);
  });
});

describe("YoudaoProvider", () => {
  it("declares one-segment-per-request caps", () => {
    const provider = new YoudaoProvider({ config: cfg, http: vi.fn() });
    expect(provider.maxSegmentsPerRequest).toBe(1);
    expect(provider.maxCharsPerRequest).toBe(4500);
  });

  it("returns [] for no segments without calling the client", async () => {
    const http = vi.fn();
    const provider = new YoudaoProvider({ config: cfg, http });
    expect(await provider.translate([])).toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });

  it("derives curtime (unix seconds) and salt from the injected clocks", async () => {
    const http = vi.fn(async (req: HttpRequestSpec) => {
      const params = new URLSearchParams(req.body);
      expect(params.get("curtime")).toBe("1690000000");
      expect(params.get("salt")).toBe("fixed-salt");
      return okResponse(["你好"]);
    });
    const provider = new YoudaoProvider({
      config: cfg,
      http,
      now: () => 1690000000123, // ms → floor to seconds
      random: () => "fixed-salt",
    });
    expect(await provider.translate(["hello"])).toEqual(["你好"]);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("refuses multi-segment batches instead of looping (QPS pacing guard)", async () => {
    const http = vi.fn();
    const provider = new YoudaoProvider({ config: cfg, http });
    await expect(provider.translate(["a", "b"])).rejects.toBeInstanceOf(TranslationError);
    expect(http).not.toHaveBeenCalled();
  });
});
