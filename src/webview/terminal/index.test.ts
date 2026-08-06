// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const fit = vi.fn();
const terminalWrite = vi.fn();
const terminalFocus = vi.fn();
const terminalDispose = vi.fn();
const terminalGetSelection = vi.fn(() => "selected output");
const terminalRefresh = vi.fn();
const terminalOptions: Record<string, unknown> = {};
let terminalConstructorOptions: Record<string, unknown> | undefined;
let dataListener: ((data: string) => void) | undefined;
let resizeListener:
  | ((size: { readonly cols: number; readonly rows: number }) => void)
  | undefined;
let mockTextarea: HTMLTextAreaElement | undefined;

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    public fit = fit;
  },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    public activate(): void {}
    public dispose(): void {}
    public onContextLoss(listener: () => void): void {
      listener();
    }
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public readonly cols = 80;
    public readonly rows = 24;
    public readonly options = terminalOptions;
    public readonly write = terminalWrite;
    public readonly focus = terminalFocus;
    public readonly dispose = terminalDispose;
    public readonly getSelection = terminalGetSelection;
    public readonly refresh = terminalRefresh;
    public textarea: HTMLTextAreaElement | undefined;
    private container?: HTMLElement;
    public constructor(options: Record<string, unknown>) {
      terminalConstructorOptions = options;
    }
    public loadAddon(addon: unknown): void {
      if (addon && typeof addon === "object" && "activate" in addon) {
        (addon as { activate(): void }).activate();
        if (this.container) {
          const canvas = document.createElement("canvas");
          this.container.querySelector(".xterm-screen")?.appendChild(canvas);
        }
      }
    }
    public open(container: HTMLElement): void {
      this.container = container;
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      const helpers = document.createElement("div");
      helpers.className = "xterm-helpers";
      mockTextarea = document.createElement("textarea");
      mockTextarea.className = "xterm-helper-textarea";
      helpers.appendChild(mockTextarea);
      screen.appendChild(helpers);
      container.appendChild(screen);
      this.textarea = mockTextarea;
    }
    public onData(listener: (data: string) => void) {
      dataListener = listener;
      return { dispose: vi.fn() };
    }
    public onResize(
      listener: (size: { readonly cols: number; readonly rows: number }) => void,
    ) {
      resizeListener = listener;
      return { dispose: vi.fn() };
    }
  },
}));

const postMessage = vi.fn();
vi.mock("../shared/vscode-api", () => ({ postMessage }));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    public activate(): void {}
    public dispose(): void {}
    public onContextLoss(listener: () => void): void {
      listener();
    }
  },
}));

const themeMocks = vi.hoisted(() => ({
  initialTheme: { background: "#101010", foreground: "#f0f0f0" },
  updatedTheme: { background: "#202020", foreground: "#e0e0e0" },
  themeChangeListener: undefined as (() => void) | undefined,
  disposeThemeWatcher: vi.fn(),
  readTerminalTheme: vi.fn(),
}));
vi.mock("./theme", () => ({
  readTerminalTheme: themeMocks.readTerminalTheme,
  watchTerminalTheme(listener: () => void) {
    themeMocks.themeChangeListener = listener;
    return themeMocks.disposeThemeWatcher;
  },
}));

let resizeObserverCallback: (() => void) | undefined;
let intersectionObserverCallback:
  | ((entries: ReadonlyArray<{ readonly isIntersecting: boolean }>) => void)
  | undefined;

class TestResizeObserver {
  public constructor(callback: () => void) {
    resizeObserverCallback = callback;
  }
  public observe(): void {}
  public disconnect(): void {}
}

class TestIntersectionObserver {
  public constructor(
    callback: (
      entries: ReadonlyArray<{ readonly isIntersecting: boolean }>,
    ) => void,
  ) {
    intersectionObserverCallback = callback;
  }
  public observe(): void {}
  public disconnect(): void {}
}

const { createTerminalView, DEFAULT_FONT_FAMILY } = await import("./index");

describe("createTerminalView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dataListener = undefined;
    resizeListener = undefined;
    terminalConstructorOptions = undefined;
    mockTextarea = undefined;
    themeMocks.themeChangeListener = undefined;
    themeMocks.readTerminalTheme
      .mockReset()
      .mockReturnValueOnce(themeMocks.initialTheme)
      .mockReturnValue(themeMocks.updatedTheme);
    globalThis.ResizeObserver = TestResizeObserver as never;
    globalThis.IntersectionObserver = TestIntersectionObserver as never;
    resizeObserverCallback = undefined;
    intersectionObserverCallback = undefined;
    (globalThis as { __ulwRenderer?: unknown }).__ulwRenderer = undefined;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
  });

  it("loads the WebGL renderer instead of the DOM renderer", () => {
    const container = document.createElement("div");
    createTerminalView(container);

    expect(container.querySelector(".xterm-screen canvas")).not.toBeNull();
  });

  it("bridges one xterm instance to the minimal message contract", () => {
    const container = document.createElement("div");
    const view = createTerminalView(container);

    dataListener?.("echo hi\r");
    resizeListener?.({ cols: 100, rows: 30 });
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "output", data: "hi" } }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "config",
          fontSize: 16,
          fontFamily: "monospace",
          cursorBlink: false,
          cursorStyle: "bar",
          scrollback: 5000,
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "focus" } }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "exit", code: 9 },
      }),
    );
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(postMessage).toHaveBeenCalledWith({
      type: "ready",
      cols: 80,
      rows: 24,
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: "input",
      data: "echo hi\r",
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: "resize",
      cols: 100,
      rows: 30,
    });
    expect(terminalWrite).toHaveBeenCalledWith("hi");
    expect(terminalConstructorOptions).toMatchObject({
      theme: themeMocks.initialTheme,
    });
    expect(terminalWrite).toHaveBeenCalledWith(
      expect.stringContaining("Shell exited with code 9"),
    );
    expect(postMessage).toHaveBeenCalledWith({
      type: "copy",
      text: "selected output",
    });
    expect(terminalOptions).toMatchObject({
      fontSize: 16,
      fontFamily: "monospace",
      cursorBlink: false,
      cursorStyle: "bar",
      scrollback: 5000,
    });
    expect(terminalFocus).toHaveBeenCalled();

    themeMocks.themeChangeListener?.();
    expect(terminalOptions.theme).toEqual(themeMocks.updatedTheme);

    view.dispose();
    expect(terminalDispose).toHaveBeenCalledOnce();
    expect(themeMocks.disposeThemeWatcher).toHaveBeenCalledOnce();
  });

  it("uses the DOM renderer when ulw.renderer is dom", () => {
    (globalThis as { __ulwRenderer?: unknown }).__ulwRenderer = "dom";
    const container = document.createElement("div");
    createTerminalView(container);
    expect(container.querySelector(".xterm-screen canvas")).toBeNull();
  });

  it("repaints after a resize and when the surface becomes visible", () => {
    const container = document.createElement("div");
    createTerminalView(container);
    terminalRefresh.mockClear();
    resizeObserverCallback?.();
    expect(terminalRefresh).toHaveBeenCalledTimes(1);
    intersectionObserverCallback?.([{ isIntersecting: true }]);
    expect(terminalRefresh).toHaveBeenCalledTimes(2);
  });

  it("uses a CJK-capable default font stack and keeps IME textarea focusable", () => {
    const container = document.createElement("div");
    createTerminalView(container);

    expect(terminalConstructorOptions).toMatchObject({
      fontFamily: DEFAULT_FONT_FAMILY,
    });
    expect(DEFAULT_FONT_FAMILY).toContain("Apple SD Gothic Neo");
    expect(DEFAULT_FONT_FAMILY).toContain("Noto Sans CJK KR");
    expect(mockTextarea?.getAttribute("inputmode")).toBe("text");

    terminalFocus.mockClear();
    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(terminalFocus).toHaveBeenCalled();
  });

  it("forwards finalized CJK composition text through onData input messages", () => {
    const container = document.createElement("div");
    createTerminalView(container);

    dataListener?.("한글");

    expect(postMessage).toHaveBeenCalledWith({
      type: "input",
      data: "한글",
    });
  });

  it("skips fit/repaint while an IME composition is active", () => {
    const container = document.createElement("div");
    createTerminalView(container);
    fit.mockClear();
    terminalRefresh.mockClear();

    mockTextarea?.dispatchEvent(new Event("compositionstart"));
    resizeObserverCallback?.();
    intersectionObserverCallback?.([{ isIntersecting: true }]);

    expect(fit).not.toHaveBeenCalled();
    expect(terminalRefresh).not.toHaveBeenCalled();

    mockTextarea?.dispatchEvent(new Event("compositionend"));
    resizeObserverCallback?.();

    expect(fit).toHaveBeenCalledTimes(1);
    expect(terminalRefresh).toHaveBeenCalledTimes(1);
  });

});
