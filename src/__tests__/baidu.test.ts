import { describe, it, expect, vi } from "vitest";
import {
  BAIDU_ENDPOINT,
  BaiduProvider,
  buildBaiduRequest,
  buildBaiduSign,
  makeSalt,
  packBaiduBatch,
  parseBaiduResponse,
  toBaiduLangCode,
  unpackBaiduTransResult,
} from "../translator/baidu";
import { md5Hex } from "../translator/md5";
import {
  AuthError,
  HttpRequestSpec,
  HttpResponseLike,
  MalformedResponseError,
  ProviderConfig,
  RateLimitError,
  SegmentCountMismatchError,
} from "../translator/provider";

const cfg = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  // Baidu: apiKey=secret, baseUrl=APP ID, model=IGNORED.
  apiKey: "654781234567890",
  baseUrl: "2015063000000001",
  model: "",
  targetLang: "zh-CN",
  ...over,
});

describe("toBaiduLangCode", () => {
  it("maps BCP-47 codes to Baidu's language codes (case-insensitive)", () => {
    expect(toBaiduLangCode("zh-CN")).toBe("zh");
    expect(toBaiduLangCode("zh")).toBe("zh");
    expect(toBaiduLangCode("zh-TW")).toBe("cht");
    expect(toBaiduLangCode("zh-Hant")).toBe("cht");
    expect(toBaiduLangCode("ja")).toBe("jp");
    expect(toBaiduLangCode("ko")).toBe("kor");
    expect(toBaiduLangCode("fr")).toBe("fra");
    expect(toBaiduLangCode("FR")).toBe("fra");
    expect(toBaiduLangCode("pt-BR")).toBe("pt");
  });

  it("falls back to the BCP-47 base subtag for shared codes (en, de, it, ...)", () => {
    // Baidu uses the same code as BCP-47 for these — pass-through.
    expect(toBaiduLangCode("en")).toBe("en");
    expect(toBaiduLangCode("en-US")).toBe("en");
    expect(toBaiduLangCode("de")).toBe("de");
    expect(toBaiduLangCode("it")).toBe("it");
  });

  it("passes unknown codes through as the base subtag (Baidu will 58001 if unsupported)", () => {
    expect(toBaiduLangCode("xx-YY")).toBe("xx");
    expect(toBaiduLangCode("  eo  ")).toBe("eo");
  });
});

describe("buildBaiduSign (concat order + md5 wiring)", () => {
  // Regression guard against md5 / concat / encoding drift. `md5Hex` itself is
  // covered by md5.test.ts (including the docs' canonical `apple` example), so
  // here we only pin the CONCAT ORDER: appid + q + salt + secret.
  it("md5(appid + q + salt + secret) — order is appid,q,salt,secret", () => {
    const appid = "2015063000000001";
    const q = "apple";
    const salt = "1435660288";
    const secret = "12345678";
    const sign = buildBaiduSign(appid, q, salt, secret);
    expect(sign).toBe(md5Hex(appid + q + salt + secret));
    // Also confirm the order is not one of the plausible transpositions.
    expect(sign).not.toBe(md5Hex(secret + q + salt + appid));
    expect(sign).not.toBe(md5Hex(appid + salt + q + secret));
  });
});

describe("makeSalt", () => {
  it("uses injected now()/rand() so tests are deterministic", () => {
    const salt = makeSalt(
      () => 1700000000000,
      () => 0.5
    );
    // `${1700000000000}${floor(0.5 * 1e6)}` -> "1700000000000500000"
    expect(salt).toBe("1700000000000500000");
  });

  it("generates a non-empty ASCII string with random source", () => {
    const s = makeSalt();
    expect(s.length).toBeGreaterThan(0);
    expect(/^[0-9]+$/.test(s)).toBe(true);
  });
});

describe("buildBaiduRequest", () => {
  it("posts application/x-www-form-urlencoded to the docs' endpoint", () => {
    const req = buildBaiduRequest("apple", cfg(), { salt: "1435660288" });
    expect(req.url).toBe(BAIDU_ENDPOINT);
    expect(req.method).toBe("POST");
    expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("includes q/from/to/appid/salt/sign — 'to' derived from targetLang, 'from' auto", () => {
    const req = buildBaiduRequest("apple", cfg({ targetLang: "ja" }), { salt: "s" });
    const params = new URLSearchParams(req.body);
    expect(params.get("q")).toBe("apple");
    expect(params.get("from")).toBe("auto");
    expect(params.get("to")).toBe("jp");
    expect(params.get("appid")).toBe("2015063000000001");
    expect(params.get("salt")).toBe("s");
    expect(params.get("sign")).toBe(buildBaiduSign("2015063000000001", "apple", "s", "654781234567890"));
  });

  it("URL-encodes newlines/spaces in q while the SIGN uses the raw text (54001 guard)", () => {
    const q = "hello world\nsecond line";
    const req = buildBaiduRequest(q, cfg(), { salt: "s" });
    // Sign is over the RAW q, not the encoded form — per docs §54001 troubleshooting.
    const expectedSign = buildBaiduSign("2015063000000001", q, "s", "654781234567890");
    const params = new URLSearchParams(req.body);
    expect(params.get("sign")).toBe(expectedSign);
    // urlencoded form uses '+' for spaces, '%0A' for LF (via the decoder both work).
    expect(params.get("q")).toBe(q);
    // And the raw body indeed uses '+' rather than %20 for the space.
    expect(req.body).toContain("q=hello+world");
  });

  it("trims the APP ID (baseUrl) before signing so trailing whitespace can't break the sign", () => {
    const req = buildBaiduRequest("x", cfg({ baseUrl: "  2015063000000001  " }), { salt: "s" });
    const params = new URLSearchParams(req.body);
    expect(params.get("appid")).toBe("2015063000000001");
    expect(params.get("sign")).toBe(
      buildBaiduSign("2015063000000001", "x", "s", "654781234567890")
    );
  });
});

describe("packBaiduBatch / unpackBaiduTransResult", () => {
  it("joins segments with LF and records per-segment line counts", () => {
    const { q, lineCounts } = packBaiduBatch(["one", "two\nlines", "three"]);
    expect(q).toBe("one\ntwo\nlines\nthree");
    expect(lineCounts).toEqual([1, 2, 1]);
  });

  it("regroups a flat dst[] back into per-segment translations", () => {
    // Baidu returns one trans_result entry per input LINE, not per source segment.
    const dsts = ["一", "二", "行", "三"];
    const out = unpackBaiduTransResult(dsts, [1, 2, 1]);
    expect(out).toEqual(["一", "二\n行", "三"]);
  });

  it("throws SegmentCountMismatchError when the totals disagree", () => {
    expect(() => unpackBaiduTransResult(["a", "b"], [1, 2, 1])).toThrowError(SegmentCountMismatchError);
  });

  it("empty lines in the source count as lines too (Baidu returns one dst per input line)", () => {
    const { q, lineCounts } = packBaiduBatch(["a\n\nb"]);
    expect(q).toBe("a\n\nb");
    expect(lineCounts).toEqual([3]);
    expect(unpackBaiduTransResult(["甲", "", "乙"], lineCounts)).toEqual(["甲\n\n乙"]);
  });
});

describe("parseBaiduResponse", () => {
  const ok = (body: unknown): HttpResponseLike => ({
    status: 200,
    text: JSON.stringify(body),
    json: body,
  });

  it("returns the flat dst[] on success (error_code omitted)", () => {
    const out = parseBaiduResponse(
      ok({
        from: "en",
        to: "zh",
        trans_result: [
          { src: "apple", dst: "苹果" },
          { src: "banana", dst: "香蕉" },
        ],
      })
    );
    expect(out).toEqual(["苹果", "香蕉"]);
  });

  it("accepts error_code === '0' / '52000' as success", () => {
    const out = parseBaiduResponse(
      ok({ error_code: "52000", trans_result: [{ src: "x", dst: "y" }] })
    );
    expect(out).toEqual(["y"]);
    const out2 = parseBaiduResponse(
      ok({ error_code: 0, trans_result: [{ src: "x", dst: "y" }] })
    );
    expect(out2).toEqual(["y"]);
  });

  it("throws AuthError for 52003 / 54001 / 54004 / 58000 / 58002 / 58003 / 90107", () => {
    for (const code of ["52003", "54001", "54004", "58000", "58002", "58003", "90107"]) {
      expect(() => parseBaiduResponse(ok({ error_code: code, error_msg: "x" }))).toThrowError(AuthError);
    }
  });

  it("throws RateLimitError for 52001 / 52002 / 54003 / 54005 (retryable)", () => {
    for (const code of ["52001", "52002", "54003", "54005"]) {
      let thrown: unknown;
      try {
        parseBaiduResponse(ok({ error_code: code, error_msg: "x" }));
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RateLimitError);
      // Retryable so the pool retries with its exponential backoff.
      expect((thrown as RateLimitError).retryable).toBe(true);
    }
  });

  it("throws MalformedResponseError for other error codes (54000 / 58001 / 20003 / unknown)", () => {
    for (const code of ["54000", "58001", "20003", "99999"]) {
      expect(() => parseBaiduResponse(ok({ error_code: code, error_msg: "x" }))).toThrowError(
        MalformedResponseError
      );
    }
  });

  it("throws MalformedResponseError on non-2xx / non-JSON / missing trans_result", () => {
    expect(() => parseBaiduResponse({ status: 500, text: "oops" })).toThrowError(MalformedResponseError);
    expect(() => parseBaiduResponse({ status: 200, text: "<html>" })).toThrowError(MalformedResponseError);
    expect(() => parseBaiduResponse(ok({}))).toThrowError(MalformedResponseError); // no trans_result
    expect(() => parseBaiduResponse(ok({ trans_result: [{ src: "x" }] }))).toThrowError(
      MalformedResponseError
    ); // dst missing
  });

  it("falls back to JSON.parse(text) when res.json is not populated", () => {
    const body = { trans_result: [{ src: "x", dst: "y" }] };
    const out = parseBaiduResponse({ status: 200, text: JSON.stringify(body) });
    expect(out).toEqual(["y"]);
  });
});

describe("BaiduProvider.translate", () => {
  const okBody = (dsts: string[]): HttpResponseLike => {
    const body = { trans_result: dsts.map((d, i) => ({ src: `s${i}`, dst: d })) };
    return { status: 200, text: JSON.stringify(body), json: body };
  };

  it("returns [] for no segments without calling the client", async () => {
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> => okBody([]));
    const provider = new BaiduProvider({ config: cfg(), http, salt: () => "s" });
    expect(await provider.translate([])).toEqual([]);
    expect(http).not.toHaveBeenCalled();
  });

  it("translates a batch in a single request (one dst per source line)", async () => {
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> =>
      okBody(["苹果", "香蕉"])
    );
    const provider = new BaiduProvider({ config: cfg(), http, salt: () => "s" });
    expect(await provider.translate(["apple", "banana"])).toEqual(["苹果", "香蕉"]);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("regroups multi-line segments back into per-segment translations", async () => {
    // Input has 2 segments, but 3 total lines -> 3 dst entries -> regroup to 2 outs.
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> =>
      okBody(["一", "二", "三"])
    );
    const provider = new BaiduProvider({ config: cfg(), http, salt: () => "s" });
    expect(await provider.translate(["one", "two\nthree"])).toEqual(["一", "二\n三"]);
  });

  it("falls back to per-segment requests when the batch line count mismatches", async () => {
    // First (batch) returns too few dsts -> mismatch -> per-segment fallback recovers.
    const responses: HttpResponseLike[] = [
      okBody(["only-one"]), // 2 expected, got 1 -> mismatch
      okBody(["苹果"]),
      okBody(["香蕉"]),
    ];
    let call = 0;
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> => responses[call++]);
    const provider = new BaiduProvider({ config: cfg(), http, salt: () => "s" });
    expect(await provider.translate(["apple", "banana"])).toEqual(["苹果", "香蕉"]);
    expect(http).toHaveBeenCalledTimes(3);
  });

  it("propagates AuthError without falling back", async () => {
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> => ({
      status: 200,
      text: JSON.stringify({ error_code: "54001", error_msg: "sign error" }),
      json: { error_code: "54001", error_msg: "sign error" },
    }));
    const provider = new BaiduProvider({ config: cfg(), http, salt: () => "s" });
    await expect(provider.translate(["a", "b"])).rejects.toBeInstanceOf(AuthError);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("propagates RateLimitError so the pool can retry (no fallback)", async () => {
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> => ({
      status: 200,
      text: JSON.stringify({ error_code: "54003", error_msg: "qps limit" }),
      json: { error_code: "54003", error_msg: "qps limit" },
    }));
    const provider = new BaiduProvider({ config: cfg(), http, salt: () => "s" });
    await expect(provider.translate(["a", "b"])).rejects.toBeInstanceOf(RateLimitError);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("sends a fresh salt per request via the injected salt fn", async () => {
    const salts = ["s1", "s2", "s3"];
    let idx = 0;
    const seen: string[] = [];
    const http = vi.fn(async (req: HttpRequestSpec): Promise<HttpResponseLike> => {
      const params = new URLSearchParams(req.body);
      seen.push(params.get("salt") || "");
      // Force the fallback path so we make three calls total.
      if (seen.length === 1) return okBody(["only"]);
      return okBody(["译"]);
    });
    const provider = new BaiduProvider({
      config: cfg(),
      http,
      salt: () => salts[idx++] ?? "s",
    });
    await provider.translate(["a", "b"]);
    // Batch + 2 per-segment retries — each with its own salt.
    expect(seen).toEqual(["s1", "s2", "s3"]);
  });

  it("does not fall back when there is only one segment (mismatch is terminal)", async () => {
    // Single-segment translate + docs return 0 lines -> mismatch, no fallback.
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> => okBody([]));
    const provider = new BaiduProvider({ config: cfg(), http, salt: () => "s" });
    await expect(provider.translate(["a"])).rejects.toBeInstanceOf(SegmentCountMismatchError);
    expect(http).toHaveBeenCalledTimes(1);
  });
});
