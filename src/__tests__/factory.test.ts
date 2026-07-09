import { describe, it, expect, vi } from "vitest";
import { createProvider } from "../translator/factory";
import { BaiduProvider, BAIDU_ENDPOINT } from "../translator/baidu";
import { DeepSeekProvider } from "../translator/deepseek";
import { normalizeSettings } from "../settings";
import { HttpRequestSpec, HttpResponseLike } from "../translator/provider";

describe("createProvider", () => {
  it("dispatches to DeepSeekProvider for providerKind === 'openai' (default)", () => {
    const settings = normalizeSettings({ apiKey: "sk", baseUrl: "https://api.deepseek.com", model: "x" });
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> => ({ status: 200, text: "" }));
    const provider = createProvider(settings, http);
    expect(provider).toBeInstanceOf(DeepSeekProvider);
    expect(provider).not.toBeInstanceOf(BaiduProvider);
  });

  it("dispatches to BaiduProvider for providerKind === 'baidu'", () => {
    const settings = normalizeSettings({
      providerKind: "baidu",
      apiKey: "secret",
      baseUrl: "2015063000000001",
      model: "ignored",
    });
    const http = vi.fn(async (_req: HttpRequestSpec): Promise<HttpResponseLike> => ({ status: 200, text: "" }));
    const provider = createProvider(settings, http);
    expect(provider).toBeInstanceOf(BaiduProvider);
    expect(provider).not.toBeInstanceOf(DeepSeekProvider);
  });

  it("Baidu-dispatched provider hits the Baidu wire endpoint (not the OpenAI base URL)", async () => {
    // End-to-end confirmation: even with baseUrl carrying an APP ID, the
    // provider sends to fanyi-api.baidu.com — the wire endpoint is hard-coded
    // in the Baidu provider and the baseUrl-as-APP-ID is used only for signing.
    const settings = normalizeSettings({
      providerKind: "baidu",
      apiKey: "secret",
      baseUrl: "2015063000000001",
    });
    let seenUrl = "";
    let seenBody = "";
    const http = vi.fn(async (req: HttpRequestSpec): Promise<HttpResponseLike> => {
      seenUrl = req.url;
      seenBody = req.body;
      const body = { trans_result: [{ src: "hi", dst: "你好" }] };
      return { status: 200, text: JSON.stringify(body), json: body };
    });
    const provider = createProvider(settings, http);
    expect(await provider.translate(["hi"])).toEqual(["你好"]);
    expect(seenUrl).toBe(BAIDU_ENDPOINT);
    expect(seenBody).toContain("appid=2015063000000001");
  });
});
