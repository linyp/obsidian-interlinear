type CreateOptions = {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
};

function applyOptions(el: HTMLElement, options?: CreateOptions): HTMLElement {
  if (!options) return el;
  if (options.cls) el.className = options.cls;
  if (options.text !== undefined) el.textContent = options.text;
  for (const [name, value] of Object.entries(options.attr ?? {})) {
    el.setAttribute(name, value);
  }
  return el;
}

/** Install the small DOM convenience surface Obsidian adds at runtime. */
export function installObsidianDomHelpers(): void {
  const proto = HTMLElement.prototype as HTMLElement & Record<string, unknown>;
  const define = (name: string, value: unknown): void => {
    if (name in proto) return;
    Object.defineProperty(proto, name, { configurable: true, value });
  };

  define("addClass", function (this: HTMLElement, ...classes: string[]) {
    this.classList.add(...classes);
  });
  define("removeClass", function (this: HTMLElement, ...classes: string[]) {
    this.classList.remove(...classes);
  });
  define("hasClass", function (this: HTMLElement, cls: string) {
    return this.classList.contains(cls);
  });
  define("toggleClass", function (this: HTMLElement, cls: string, value: boolean) {
    this.classList.toggle(cls, value);
  });
  define("empty", function (this: HTMLElement) {
    this.replaceChildren();
  });
  define("createEl", function (this: HTMLElement, tag: string, options?: CreateOptions) {
    const el = applyOptions(document.createElement(tag), options);
    this.appendChild(el);
    return el;
  });
  define("createDiv", function (this: HTMLElement, options?: CreateOptions) {
    const el = applyOptions(document.createElement("div"), options);
    this.appendChild(el);
    return el;
  });
  define("createSpan", function (this: HTMLElement, options?: CreateOptions) {
    const el = applyOptions(document.createElement("span"), options);
    this.appendChild(el);
    return el;
  });

  Object.assign(globalThis, {
    createDiv: (options?: CreateOptions) => applyOptions(document.createElement("div"), options),
  });
}
