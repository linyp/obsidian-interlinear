// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./domTestSetup";

const obsidian = vi.hoisted(() => ({
  notice: vi.fn(),
  render: vi.fn(),
  setIcon: vi.fn(),
}));

vi.mock("obsidian", () => ({
  MarkdownRenderer: { render: obsidian.render },
  MarkdownView: class {},
  Notice: class {
    constructor(message: string, timeout?: number) {
      obsidian.notice(message, timeout);
    }
  },
  Platform: { isMobile: false },
  setIcon: obsidian.setIcon,
}));

import { TranslationController } from "../ui/translateButton";
import { TranslationCache } from "../translator/cache";
import type { HttpRequestSpec, HttpResponseLike } from "../translator/provider";
import {
  cacheIdentity,
  normalizeSettings,
  updateActivePreset,
  type InterlinearSettings,
} from "../settings";

beforeAll(installObsidianDomHelpers);

interface Harness {
  controller: TranslationController;
  cache: TranslationCache;
  container: HTMLElement;
  viewContainer: HTMLElement;
  http: ReturnType<typeof vi.fn<(req: HttpRequestSpec) => Promise<HttpResponseLike>>>;
  setMarkdown(markdown: string): void;
  setSettings(update: (current: InterlinearSettings) => InterlinearSettings): void;
  settings(): InterlinearSettings;
}

function responseFor(req: HttpRequestSpec): HttpResponseLike {
  const body = JSON.parse(req.body) as { messages: Array<{ content: string }> };
  const user = body.messages[1].content;
  const count = Array.from(user.matchAll(/^<<<SEG (\d+)>>>$/gm)).length;
  const content = Array.from(
    { length: count },
    (_, index) => `<<<SEG ${index + 1}>>>\n译文-${index + 1}`
  ).join("\n\n");
  const json = { choices: [{ message: { content } }] };
  return { status: 200, text: JSON.stringify(json), json };
}

function createHarness(markdown: string, visibleHtml = markdown): Harness {
  let currentMarkdown = markdown;
  let settings = normalizeSettings({ apiKey: "key" });
  const container = document.createElement("div");
  container.innerHTML = visibleHtml;
  const contentEl = document.createElement("div");
  const viewContainer = document.createElement("div");
  const view = {
    file: { path: "note.md" },
    previewMode: { containerEl: container },
    containerEl: viewContainer,
    contentEl,
    getMode: () => "preview",
    getViewData: () => currentMarkdown,
  };
  const app = {
    workspace: {
      getActiveViewOfType: () => view,
    },
  };
  const component = {
    registerDomEvent: (
      el: HTMLElement,
      type: string,
      callback: EventListenerOrEventListenerObject
    ) => el.addEventListener(type, callback),
    register: (_callback: () => void) => undefined,
  };
  const cache = new TranslationCache();
  const http = vi.fn(async (req: HttpRequestSpec) => responseFor(req));

  obsidian.render.mockImplementation(
    async (_app: unknown, renderedMarkdown: string, target: HTMLElement) => {
      if (target.hasClass("it-offscreen-render")) target.innerHTML = renderedMarkdown;
      else target.textContent = renderedMarkdown;
    }
  );

  return {
    controller: new TranslationController({
      app: app as never,
      component: component as never,
      http,
      getSettings: () => settings,
      cache,
    }),
    cache,
    container,
    viewContainer,
    http,
    setMarkdown(next: string) {
      currentMarkdown = next;
      container.innerHTML = next;
    },
    setSettings(update) {
      settings = update(settings);
    },
    settings: () => settings,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  obsidian.notice.mockReset();
  obsidian.render.mockReset();
  obsidian.setIcon.mockReset();
});

describe("TranslationController request boundary", () => {
  it("keeps the status bar and FAB on the same explicit translation flow", async () => {
    const h = createHarness("<p>Hello</p>");
    h.setSettings((current) => ({ ...current, showFab: "always" }));
    const statusBar = document.createElement("div");

    h.controller.mountStatusBar(statusBar);
    h.controller.syncActiveView();
    expect(statusBar.querySelector(".it-sb-translate")).not.toBeNull();
    expect(h.viewContainer.querySelector(".it-fab-main")).not.toBeNull();

    (statusBar.querySelector(".it-sb-translate") as HTMLElement).click();
    await vi.waitFor(() =>
      expect(h.container.querySelector(".it-translation")).not.toBeNull()
    );
    expect(h.http).toHaveBeenCalledTimes(1);

    (statusBar.querySelector(".it-sb-mode") as HTMLElement).click();
    expect(h.container.hasClass("it-mode-translation-only")).toBe(true);
    expect(h.http).toHaveBeenCalledTimes(1);

    h.controller.clearActiveView();
    h.cache.clear();
    (h.viewContainer.querySelector(".it-fab-main") as HTMLElement).click();
    await vi.waitFor(() => expect(h.http).toHaveBeenCalledTimes(2));
  });

  it("translates visible text first and excludes it from whole-document misses", async () => {
    const h = createHarness("<p>Hello</p><p>World</p>", "<p>Hello</p>");

    h.controller.toggleTranslate();

    await vi.waitFor(() => {
      const id = cacheIdentity(h.settings());
      expect(h.cache.get("Hello", id, "zh-CN")).toBeDefined();
      expect(h.cache.get("World", id, "zh-CN")).toBeDefined();
    });
    const sent = h.http.mock.calls.map(([req]) => {
      const body = JSON.parse(req.body) as { messages: Array<{ content: string }> };
      return body.messages[1].content;
    });
    expect(sent.filter((body) => body.includes("Hello"))).toHaveLength(1);
    expect(sent.filter((body) => body.includes("World"))).toHaveLength(1);
  });

  it("never sends a cache-miss request from layout/render sync or config refresh", async () => {
    const h = createHarness("<p>Hello</p>");
    h.controller.toggleTranslate();
    await vi.waitFor(() =>
      expect(h.container.querySelector(".it-translation")).not.toBeNull()
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    h.setMarkdown("<p>New unseen text</p>");
    h.controller.syncActiveView();
    h.setSettings((current) => updateActivePreset(current, { apiKey: "new-key" }));
    h.controller.onProviderConfigChanged();
    await new Promise((resolve) => window.setTimeout(resolve, 180));

    expect(h.http).toHaveBeenCalledTimes(1);
  });

  it("invalidates rendered state on prompt changes and retranslates only after an explicit action", async () => {
    const h = createHarness("<p>Hello</p>");
    h.controller.toggleTranslate();
    await vi.waitFor(() =>
      expect(h.container.querySelector(".it-translation")).not.toBeNull()
    );
    expect(h.http).toHaveBeenCalledTimes(1);

    h.setSettings((current) =>
      updateActivePreset(current, { customInstructions: "Translate Hello formally." })
    );
    h.controller.onProviderConfigChanged();
    await Promise.resolve();

    expect(h.http).toHaveBeenCalledTimes(1);
    expect(h.container.querySelector(".it-translation")).toBeNull();

    h.controller.toggleTranslate();
    await vi.waitFor(() => expect(h.http).toHaveBeenCalledTimes(2));
  });

  it("waits for an explicit action before translating changed note content", async () => {
    const h = createHarness("<p>Version one</p>");
    h.controller.toggleTranslate();
    await vi.waitFor(() =>
      expect(h.container.querySelector(".it-translation")).not.toBeNull()
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(h.http).toHaveBeenCalledTimes(1);

    h.setMarkdown("<p>Version two</p>");
    h.controller.syncActiveView();
    expect(h.http).toHaveBeenCalledTimes(1);

    h.controller.toggleTranslate();
    await vi.waitFor(() => expect(h.http).toHaveBeenCalledTimes(2));
  });

  it("does not continue into whole-note work after the user clears an in-flight run", async () => {
    const h = createHarness("<p>Hello</p><p>World</p>", "<p>Hello</p>");
    let finishVisible!: () => void;
    h.http.mockImplementationOnce(
      (req) =>
        new Promise((resolve) => {
          finishVisible = () => resolve(responseFor(req));
        })
    );

    h.controller.toggleTranslate();
    await vi.waitFor(() => expect(h.http).toHaveBeenCalledTimes(1));
    h.controller.clearActiveView();
    finishVisible();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(h.http).toHaveBeenCalledTimes(1);
    expect(h.container.querySelector(".it-translation")).toBeNull();
  });
});
