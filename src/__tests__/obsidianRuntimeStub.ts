/** Resolvable test-only stand-in for the types-only `obsidian` package. */
export const requestUrl = async (): Promise<never> => {
  throw new Error("requestUrl must be mocked by the test");
};

export const MarkdownRenderer = {
  render: async (): Promise<never> => {
    throw new Error("MarkdownRenderer.render must be mocked by the test");
  },
};

export class MarkdownView {}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

export const Platform = { isMobile: false };

export function setIcon(_el: HTMLElement, _icon: string): void {}
