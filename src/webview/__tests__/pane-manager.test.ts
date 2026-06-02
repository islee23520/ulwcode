// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postMessage } from "../shared/vscode-api";

vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
}));

interface TerminalMockInstance {
  options: unknown;
  loadAddon: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

interface FitAddonMockInstance {
  fit: ReturnType<typeof vi.fn>;
}

interface WebglAddonMockInstance {
  onContextLoss: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  triggerContextLoss: () => void;
}

const mockState = vi.hoisted(() => ({
  terminalInstances: [] as TerminalMockInstance[],
  fitAddonInstances: [] as FitAddonMockInstance[],
  webglAddonInstances: [] as WebglAddonMockInstance[],
}));

function mockElementFromPoint(result: Element | null): void {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => result),
  });
}

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    public readonly loadAddon = vi.fn(
      (addon: { activate?: (terminal: MockTerminal) => void }) => {
        addon.activate?.(this);
      },
    );

    public readonly open = vi.fn();

    public readonly write = vi.fn();

    public readonly resize = vi.fn();

    public readonly focus = vi.fn();

    public readonly dispose = vi.fn();

    constructor(public readonly options: unknown) {
      mockState.terminalInstances.push(this);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    public readonly fit = vi.fn();

    constructor() {
      mockState.fitAddonInstances.push(this);
    }

    activate(): void {}

    dispose(): void {}
  },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class MockWebglAddon {
    private contextLossHandler: (() => void) | undefined;

    public readonly onContextLoss = vi.fn((handler: () => void) => {
      this.contextLossHandler = handler;
    });

    public readonly dispose = vi.fn();

    constructor() {
      mockState.webglAddonInstances.push(this);
    }

    activate(): void {}

    triggerContextLoss(): void {
      this.contextLossHandler?.();
    }
  },
}));

import { PaneManager } from "../pane-manager";

describe("PaneManager", () => {
  beforeEach(() => {
    mockState.terminalInstances.length = 0;
    mockState.fitAddonInstances.length = 0;
    mockState.webglAddonInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "elementFromPoint");
  });

  it("creates multiple panes and falls back to canvas for the 5th pane", () => {
    const manager = new PaneManager();

    const panes = Array.from({ length: 5 }, (_, index) => {
      const container = document.createElement("div");
      return manager.createPane(`pane-${index + 1}`, container);
    });

    expect(panes).toHaveLength(5);
    expect(manager.getAllPaneIds()).toEqual([
      "pane-1",
      "pane-2",
      "pane-3",
      "pane-4",
      "pane-5",
    ]);
    expect(
      panes.slice(0, 4).every((pane) => pane.rendererType === "webgl"),
    ).toBe(true);
    expect(panes[4].rendererType).toBe("canvas");
    expect(mockState.webglAddonInstances).toHaveLength(4);
  });

  it("writes data and resizes only the targeted pane", () => {
    const manager = new PaneManager();
    manager.createPane("pane-a", document.createElement("div"));
    manager.createPane("pane-b", document.createElement("div"));

    manager.writeData("pane-b", "hello");
    manager.resizePane("pane-b", 120, 40);

    expect(mockState.terminalInstances[1].write).toHaveBeenCalledWith("hello");
    expect(mockState.terminalInstances[0].write).not.toHaveBeenCalled();
    expect(mockState.terminalInstances[1].resize).toHaveBeenCalledWith(120, 40);
    expect(mockState.terminalInstances[0].resize).not.toHaveBeenCalled();
  });

  it("focuses the requested pane", () => {
    const manager = new PaneManager();
    manager.createPane("pane-a", document.createElement("div"));
    manager.createPane("pane-b", document.createElement("div"));

    manager.focusPane("pane-a");

    expect(mockState.terminalInstances[0].focus).toHaveBeenCalledTimes(1);
    expect(mockState.terminalInstances[1].focus).not.toHaveBeenCalled();
  });

  it("hides without fitting and shows with fitting after becoming visible", () => {
    const manager = new PaneManager();
    const container = document.createElement("div");

    manager.createPane("pane-a", container);

    manager.hidePane("pane-a");
    expect(container.style.display).toBe("none");
    expect(mockState.fitAddonInstances[0].fit).not.toHaveBeenCalled();

    manager.showPane("pane-a");
    expect(container.style.display).toBe("");
    expect(mockState.fitAddonInstances[0].fit).toHaveBeenCalledTimes(1);
  });

  it("disposes a pane, marks it disposed, removes it, and frees webgl capacity", () => {
    const manager = new PaneManager();
    manager.createPane("pane-a", document.createElement("div"));
    const target = manager.createPane("pane-b", document.createElement("div"));
    manager.createPane("pane-c", document.createElement("div"));
    manager.createPane("pane-d", document.createElement("div"));
    manager.createPane("pane-e", document.createElement("div"));

    manager.disposePane("pane-b");

    expect(mockState.terminalInstances[1].dispose).toHaveBeenCalledTimes(1);
    expect(target.disposed).toBe(true);
    expect(manager.getPane("pane-b")).toBeUndefined();

    const replacement = manager.createPane("pane-f", document.createElement("div"));
    expect(replacement.rendererType).toBe("webgl");
  });

  it("disposes all panes and clears the manager", () => {
    const manager = new PaneManager();
    const first = manager.createPane("pane-a", document.createElement("div"));
    const second = manager.createPane("pane-b", document.createElement("div"));

    manager.dispose();

    expect(first.disposed).toBe(true);
    expect(second.disposed).toBe(true);
    expect(mockState.terminalInstances[0].dispose).toHaveBeenCalledTimes(1);
    expect(mockState.terminalInstances[1].dispose).toHaveBeenCalledTimes(1);
    expect(manager.getAllPaneIds()).toEqual([]);
  });

  it("replaces an existing pane id by disposing the previous terminal first", () => {
    const manager = new PaneManager();
    manager.createPane("pane-a", document.createElement("div"));

    const replacement = manager.createPane("pane-a", document.createElement("div"));

    expect(mockState.terminalInstances[0].dispose).toHaveBeenCalledTimes(1);
    expect(manager.getPane("pane-a")).toBe(replacement);
  });

  it("wires webgl context loss to dispose the addon", () => {
    const manager = new PaneManager();
    manager.createPane("pane-a", document.createElement("div"));

    mockState.webglAddonInstances[0].triggerContextLoss();

    expect(mockState.webglAddonInstances[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("routes dropped files to the pane under the drop coordinates", async () => {
    const manager = new PaneManager();
    const root = document.createElement("div");
    manager.init(root);

    const paneA = document.createElement("div");
    paneA.className = "layout-pane";
    paneA.dataset.paneId = "pane-a";
    root.appendChild(paneA);
    manager.createPane("pane-a", paneA);

    const paneB = document.createElement("div");
    paneB.className = "layout-pane";
    paneB.dataset.paneId = "pane-b";
    const inner = document.createElement("span");
    paneB.appendChild(inner);
    root.appendChild(paneB);
    manager.createPane("pane-b", paneB);

    mockElementFromPoint(inner);

    await manager.handleDrop({
      clientX: 24,
      clientY: 18,
      shiftKey: true,
      dataTransfer: {
        types: ["text/uri-list"],
        items: [],
        files: [],
        getData: (type: string) =>
          type === "text/uri-list" ? "file:///workspace/pane-b.ts" : "",
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as DragEvent);

    expect(manager.getPaneAtPoint(24, 18)).toBe("pane-b");
    expect(postMessage).toHaveBeenCalledWith({
      type: "filesDropped",
      files: ["/workspace/pane-b.ts"],
      shiftKey: true,
      paneId: "pane-b",
    });
  });

  it("falls back to the focused pane when drop coordinates miss every pane", async () => {
    const manager = new PaneManager();
    manager.createPane("pane-a", document.createElement("div"));
    manager.createPane("pane-b", document.createElement("div"));
    manager.focusPane("pane-a");

    mockElementFromPoint(null);

    await manager.handleDrop({
      clientX: 999,
      clientY: 999,
      shiftKey: false,
      dataTransfer: {
        types: ["text/uri-list"],
        items: [],
        files: [],
        getData: (type: string) =>
          type === "text/uri-list" ? "file:///workspace/fallback.ts" : "",
      },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as DragEvent);

    expect(manager.getPaneAtPoint(999, 999)).toBeNull();
    expect(postMessage).toHaveBeenCalledWith({
      type: "filesDropped",
      files: ["/workspace/fallback.ts"],
      shiftKey: false,
      paneId: "pane-a",
    });
  });

  it("allows macOS Finder file URL drags so the drop event can fire", () => {
    const manager = new PaneManager();
    const root = document.createElement("div");
    manager.init(root);
    const event = new Event("dragover", {
      bubbles: true,
      cancelable: true,
    }) as DragEvent;
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      value: {
        types: ["public.file-url"],
        items: [],
      },
    });
    const preventDefault = vi.spyOn(event, "preventDefault");
    const stopPropagation = vi.spyOn(event, "stopPropagation");

    root.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("allows VS Code Explorer plain text drags so the drop event can fire", () => {
    const manager = new PaneManager();
    const root = document.createElement("div");
    manager.init(root);
    const event = new Event("dragover", {
      bubbles: true,
      cancelable: true,
    }) as DragEvent;
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      value: {
        types: ["text/plain"],
        items: [],
      },
    });
    const preventDefault = vi.spyOn(event, "preventDefault");
    const stopPropagation = vi.spyOn(event, "stopPropagation");

    root.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  describe("backend tracking", () => {
    it("returns 'native' by default", () => {
      const manager = new PaneManager();
      expect(manager.getBackend("any-pane")).toBe("native");
    });

    it("stores backend for registered pane", () => {
      const manager = new PaneManager();
      const container = document.createElement("div");
      manager.registerPane("pane-1", null, container, "tmux");
      expect(manager.getBackend("pane-1")).toBe("tmux");
    });

    it("updates backend via setBackend", () => {
      const manager = new PaneManager();
      const container = document.createElement("div");
      manager.registerPane("pane-1", null, container);
      expect(manager.getBackend("pane-1")).toBe("native");

      manager.setBackend("pane-1", "zellij");
      expect(manager.getBackend("pane-1")).toBe("zellij");
    });

    it("cleans up backend tracking on disposePane", () => {
      const manager = new PaneManager();
      const container = document.createElement("div");
      manager.registerPane("pane-1", null, container, "tmux");
      expect(manager.getBackend("pane-1")).toBe("tmux");

      manager.disposePane("pane-1");
      expect(manager.getBackend("pane-1")).toBe("native");
    });

    it("disposes old terminal and updates backend on switchPaneBackend", async () => {
      const manager = new PaneManager();
      const container = document.createElement("div");
      const instance = manager.createPane("pane-1", container, {}, "native");
      const terminal = instance.terminal;

      await manager.switchPaneBackend("pane-1", "tmux");

      expect(terminal.dispose).toHaveBeenCalled();
      expect(manager.getBackend("pane-1")).toBe("tmux");
      expect(instance.disposed).toBe(true);
    });

    it("re-initializes terminal on writeData if pane was switched", async () => {
      const manager = new PaneManager();
      const container = document.createElement("div");
      const instance = manager.createPane("pane-1", container, {}, "native");
      const oldTerminal = instance.terminal;

      await manager.switchPaneBackend("pane-1", "tmux");
      expect(instance.disposed).toBe(true);

      manager.writeData("pane-1", "new data");

      const newInstance = manager.getPane("pane-1")!;
      expect(newInstance).not.toBe(instance);
      expect(newInstance.disposed).toBe(false);
      expect(newInstance.terminal).not.toBe(oldTerminal);
      expect(mockState.terminalInstances[mockState.terminalInstances.length - 1].write).toHaveBeenCalledWith("new data");
    });
  });
});
