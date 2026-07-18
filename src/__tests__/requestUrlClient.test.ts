import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock("obsidian", () => ({ requestUrl }));

import { obsidianRequestUrlClient } from "../translator/requestUrlClient";

describe("obsidianRequestUrlClient", () => {
  beforeEach(() => requestUrl.mockReset());

  it("maps the injected request to requestUrl with non-throwing HTTP status handling", async () => {
    requestUrl.mockResolvedValue({
      status: 429,
      text: '{"error":"limited"}',
      json: { error: "limited" },
      headers: { "retry-after": "2" },
    });
    const spec = {
      url: "https://api.example.com/chat/completions",
      method: "POST" as const,
      headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
      body: "{}",
    };

    await expect(obsidianRequestUrlClient(spec)).resolves.toEqual({
      status: 429,
      text: '{"error":"limited"}',
      json: { error: "limited" },
      headers: { "retry-after": "2" },
    });
    expect(requestUrl).toHaveBeenCalledWith({
      ...spec,
      contentType: "application/json",
      throw: false,
    });
  });

  it("tolerates requestUrl's throwing lazy json getter", async () => {
    const response = {
      status: 502,
      text: "not json",
      headers: {},
      get json(): unknown {
        throw new Error("invalid json");
      },
    };
    requestUrl.mockResolvedValue(response);

    await expect(
      obsidianRequestUrlClient({
        url: "https://api.example.com/chat/completions",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).resolves.toMatchObject({ status: 502, text: "not json", json: undefined });
  });
});
