import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  BaiduProvider,
  BaiduConfig,
  buildBaiduRequest,
  parseBaiduResponse,
  BAIDU_ENDPOINT,
} from "../translator/baidu";
import {
  HttpRequestSpec,
  HttpResponseLike,
  TranslationError,
  AuthError,
  RateLimitError,
} from "../translator/provider";
import { isRetryable } from "../core/rateLimiter";

const cfg: BaiduConfig = { appId: "20240001", appSecret: "sec-ret", targetLang: "zh-CN" };

function okResponse(rows: Array<{ src: string; dst: string }>): HttpResponseLike {
  const payload = { from: "en", to: "zh", trans_result: rows };
  return { status: 200, text: JSON.stringify(payload), json: payload };
}

function errorResponse(code: string, msg = ""): HttpResponseLike {
  const payload = { error_code: code, error_msg: msg };
  return { status: 200, text: JSON.stringify(payload), json: payload };
}

describe("buildBaiduRequest", () => {
  it("signs md5(appid + RAW q + salt + secret) — before url-encoding", () => {
    const q = "What is 100% + 中文?"; // % and CJK force q's encoded form ≠ raw form
    const salt = "72351";
    const req = buildBaiduRequest(q, cfg, salt);
    const expectedSign = createHash("md5")
      .update(cfg.appId + q + salt + cfg.appSecret, "utf8")
      .digest("hex");
    const params = new URLSearchParams(req.body);
    expect(params.get("sign")).toBe(expectedSign);
    expect(params.get("q")).toBe(q); // URLSearchParams decodes — round-trips intact
    expect(params.get("appid")).toBe(cfg.appId);
    expect(params.get("salt")).toBe(salt);
    expect(params.get("from")).toBe("auto");
    expect(params.get("to")).toBe("zh");
  });

  it("posts form-encoded to the fixed endpoint", () => {
    const req = buildBaiduRequest("hi", cfg, "1");
    expect(req.url).toBe(BAIDU_ENDPOINT);
    expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(req.body).not.toContain(" "); // body is fully encoded
  });
});

describe("parseBaiduResponse", () => {
  it("re-joins the per-line trans_result rows of a multi-line segment", () => {
    const res = okResponse([
      { src: "line one", dst: "第一行" },
      { src: "line two", dst: "第二行" },
    ]);
    expect(parseBaiduResponse(res)).toBe("第一行\n第二行");
  });

  it("maps error codes carried in an HTTP-200 body", () => {
    expect(() => parseBaiduResponse(errorResponse("52003"))).toThrow(AuthError);
    expect(() => parseBaiduResponse(errorResponse("54001"))).toThrow(AuthError);
    expect(() => parseBaiduResponse(errorResponse("54003"))).toThrow(RateLimitError);
    expect(() => parseBaiduResponse(errorResponse("54004"))).toThrow(TranslationError);
    expect(() => parseBaiduResponse(errorResponse("58001"))).toThrow(TranslationError);
  });

  it("treats 52001/52002 (transient) as retryable and other codes as not", () => {
    for (const code of ["52001", "52002"]) {
      try {
        parseBaiduResponse(errorResponse(code));
        expect.unreachable();
      } catch (err) {
        expect(err).not.toBeInstanceOf(TranslationError);
        expect(isRetryable(err)).toBe(true); // plain Error → pool default retries
      }
    }
    try {
      parseBaiduResponse(errorResponse("54005"));
      expect.unreachable();
    } catch (err) {
      expect(isRetryable(err)).toBe(false);
    }
  });

  it("accepts a numeric error_code and the documented 52000 success code", () => {
    const payload = { error_code: 52000, trans_result: [{ src: "hi", dst: "你好" }] };
    expect(
      parseBaiduResponse({ status: 200, text: JSON.stringify(payload), json: payload })
    ).toBe("你好");
    const numErr = { error_code: 54003, error_msg: "limited" };
    expect(() =>
      parseBaiduResponse({ status: 200, text: JSON.stringify(numErr), json: numErr })
    ).toThrow(RateLimitError);
  });
});

describe("BaiduProvider", () => {
  it("declares one-segment-per-request caps", () => {
    const provider = new BaiduProvider({ config: cfg, http: vi.fn() });
    expect(provider.maxSegmentsPerRequest).toBe(1);
    expect(provider.maxCharsPerRequest).toBe(1800);
  });

  it("returns [] for no segments without calling the client", async () => {
    const http = vi.fn();
    const provider = new BaiduProvider({ config: cfg, http });
    expect(await provider.translate([])).toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });

  it("translates exactly one segment per HTTP request with the injected salt", async () => {
    const http = vi.fn(async (req: HttpRequestSpec) => {
      const params = new URLSearchParams(req.body);
      expect(params.get("salt")).toBe("fixed-salt");
      return okResponse([{ src: "hello", dst: "你好" }]);
    });
    const provider = new BaiduProvider({ config: cfg, http, random: () => "fixed-salt" });
    expect(await provider.translate(["hello"])).toEqual(["你好"]);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("refuses multi-segment batches instead of looping (QPS pacing guard)", async () => {
    const http = vi.fn();
    const provider = new BaiduProvider({ config: cfg, http });
    await expect(provider.translate(["a", "b"])).rejects.toBeInstanceOf(TranslationError);
    expect(http).not.toHaveBeenCalled();
  });
});
