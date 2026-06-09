import { describe, it, expect } from "vitest";
import {
  buildChatRequest,
  parseChatResponse,
  buildSystemPrompt,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
} from "../translator/deepseek";
import {
  ProviderConfig,
  HttpResponseLike,
  AuthError,
  RateLimitError,
  MalformedResponseError,
  SegmentCountMismatchError,
} from "../translator/provider";

const cfg: ProviderConfig = {
  apiKey: "sk-test-key",
  baseUrl: DEEPSEEK_DEFAULT_BASE_URL,
  model: DEEPSEEK_DEFAULT_MODEL,
  targetLang: "zh-CN",
};

function chatResponse(content: string, status = 200): HttpResponseLike {
  const payload = { choices: [{ message: { content } }] };
  return { status, text: JSON.stringify(payload), json: payload };
}

describe("buildChatRequest", () => {
  it("targets the OpenAI-compatible /chat/completions endpoint", () => {
    const req = buildChatRequest(["hi"], cfg);
    expect(req.url).toBe("https://api.deepseek.com/chat/completions");
    expect(req.method).toBe("POST");
  });

  it("does not duplicate the slash if baseUrl has a trailing slash", () => {
    const req = buildChatRequest(["hi"], { ...cfg, baseUrl: "https://api.deepseek.com/" });
    expect(req.url).toBe("https://api.deepseek.com/chat/completions");
  });

  it("sends the configured model and disables streaming", () => {
    const body = JSON.parse(buildChatRequest(["hi"], cfg).body);
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.stream).toBe(false);
  });

  it("includes a Bearer auth header and JSON content type", () => {
    const req = buildChatRequest(["hi"], cfg);
    expect(req.headers.Authorization).toBe("Bearer sk-test-key");
    expect(req.headers["Content-Type"]).toBe("application/json");
  });

  it("packs segments into the user message with numbered markers", () => {
    const body = JSON.parse(buildChatRequest(["alpha", "beta"], cfg).body);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toContain("<<<SEG 1>>>");
    expect(body.messages[1].content).toContain("<<<SEG 2>>>");
    expect(body.messages[1].content).toContain("alpha");
  });

  it("constrains the system prompt (target lang, output-only, markdown)", () => {
    const p = buildSystemPrompt("zh-CN");
    expect(p).toContain("zh-CN");
    expect(p.toLowerCase()).toContain("only");
    expect(p.toLowerCase()).toContain("markdown");
  });

  it("appends custom instructions AFTER the segment contract", () => {
    const p = buildSystemPrompt("zh-CN", "Translate 'token' as 词元.");
    expect(p).toContain("Translate 'token' as 词元.");
    // The <<<SEG k>>> contract must still precede the user-provided text.
    expect(p.indexOf("<<<SEG")).toBeLessThan(p.indexOf("Translate 'token' as 词元."));
  });

  it("leaves the system prompt unchanged for empty/whitespace custom instructions", () => {
    expect(buildSystemPrompt("zh-CN", "")).toBe(buildSystemPrompt("zh-CN"));
    expect(buildSystemPrompt("zh-CN", "   ")).toBe(buildSystemPrompt("zh-CN"));
  });

  it("flows custom instructions from config into the system message", () => {
    const body = JSON.parse(buildChatRequest(["hi"], { ...cfg, customInstructions: "GLOSSARY-X" }).body);
    expect(body.messages[0].content).toContain("GLOSSARY-X");
  });
});

describe("parseChatResponse", () => {
  it("unpacks a well-formed batch", () => {
    const content = "<<<SEG 1>>>\n你好\n\n<<<SEG 2>>>\n世界";
    expect(parseChatResponse(chatResponse(content), 2)).toEqual(["你好", "世界"]);
  });

  it("accepts a marker-less single segment (per-segment fallback leniency)", () => {
    expect(parseChatResponse(chatResponse("你好世界"), 1)).toEqual(["你好世界"]);
  });

  it("parses from .text when .json is absent", () => {
    const res: HttpResponseLike = {
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: "<<<SEG 1>>>\nHola" } }] }),
    };
    expect(parseChatResponse(res, 1)).toEqual(["Hola"]);
  });

  it("throws AuthError on 401/403", () => {
    expect(() => parseChatResponse(chatResponse("x", 401), 1)).toThrow(AuthError);
    expect(() => parseChatResponse(chatResponse("x", 403), 1)).toThrow(AuthError);
  });

  it("throws a retryable RateLimitError on 429", () => {
    let err: unknown;
    try {
      parseChatResponse(chatResponse("x", 429), 1);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryable).toBe(true);
  });

  it("reads Retry-After (seconds) into RateLimitError.retryAfterMs on 429", () => {
    let err: unknown;
    try {
      parseChatResponse({ status: 429, text: "", headers: { "Retry-After": "12" } }, 1);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(12000);
  });

  it("tolerates a missing or non-numeric Retry-After header", () => {
    let err: unknown;
    try {
      parseChatResponse({ status: 429, text: "" }, 1);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBeUndefined();
  });

  it("throws MalformedResponseError on other non-2xx", () => {
    expect(() => parseChatResponse(chatResponse("x", 500), 1)).toThrow(MalformedResponseError);
  });

  it("throws MalformedResponseError on an invalid JSON body", () => {
    expect(() => parseChatResponse({ status: 200, text: "not json{" }, 1)).toThrow(
      MalformedResponseError
    );
  });

  it("throws MalformedResponseError when content is missing", () => {
    expect(() => parseChatResponse({ status: 200, text: "{}", json: {} }, 1)).toThrow(
      MalformedResponseError
    );
  });

  it("throws SegmentCountMismatchError when a multi-segment batch is short", () => {
    let err: unknown;
    try {
      parseChatResponse(chatResponse("<<<SEG 1>>>\nonly one"), 2);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SegmentCountMismatchError);
    expect((err as SegmentCountMismatchError).expected).toBe(2);
    expect((err as SegmentCountMismatchError).got).toBe(1);
  });

  it("marks non-retryable errors as such", () => {
    expect(new AuthError().retryable).toBe(false);
    expect(new MalformedResponseError().retryable).toBe(false);
    expect(new SegmentCountMismatchError(2, 1).retryable).toBe(false);
  });
});
