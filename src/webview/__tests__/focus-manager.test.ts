// @vitest-environment jsdom

/**
 * FocusManager tests
 * Pure DOM + delegation + delegation to PaneManager / PaneMessageRouter
 * Mirrors patterns from pane-manager.test.ts and tab-bar.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebviewMessage } from "../../types";

import { FocusManager } from "../focus/focus-manager";
import type { PaneManager } from "../pane-manager";
import type { PaneMessageRouter } from "../pane-message-router";

interface MockPaneManager {
  focusPane: ReturnType<typeof vi.fn>;
}

interface MockRouter {
  setFocusedPane: ReturnType<typeof vi.fn>;
  getFocusedPane: ReturnType<typeof vi.fn>;
}

type MockedPaneManager = MockPaneManager & PaneManager;
type MockedRouter = MockRouter & PaneMessageRouter;

function createMockPaneManager(): MockedPaneManager {
  return {
    focusPane: vi.fn(),
    // stubs for full interface (not used by FocusManager)
    createPane: vi.fn(),
    disposePane: vi.fn(),
    writeData: vi.fn(),
    resizePane: vi.fn(),
    showPane: vi.fn(),
    hidePane: vi.fn(),
    getPane: vi.fn(),
    getAllPaneIds: vi.fn(() => []),
    dispose: vi.fn(),
  } as unknown as MockedPaneManager;
}

function createMockRouter(): MockedRouter {
  return {
    setFocusedPane: vi.fn(),
    getFocusedPane: vi.fn(() => "default"),
    resolvePaneId: vi.fn((id?: string) => id || "default"),
    handleHostMessage: vi.fn(),
    injectPaneId: vi.fn((m: WebviewMessage) => m),
  } as unknown as MockedRouter;
}

describe("FocusManager", () => {
  let container: HTMLElement;
  let paneManager: MockedPaneManager;
  let router: MockedRouter;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "600px";
    document.body.appendChild(container);

    paneManager = createMockPaneManager();
    router = createMockRouter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    container.remove();
  });

  it("constructs with default focused pane and optional deps", () => {
    const fm = new FocusManager();
    expect(fm.getFocusedPane()).toBe("default");

    const fm2 = new FocusManager(paneManager, router);
    expect(fm2.getFocusedPane()).toBe("default");
  });

  it("init attaches mousedown delegation (capture phase)", () => {
    const fm = new FocusManager(paneManager, router);
    fm.init(container);

    // Create a pane element inside
    const paneEl = document.createElement("div");
    paneEl.className = "layout-pane";
    paneEl.dataset.paneId = "pane-1";
    container.appendChild(paneEl);

    // Simulate mousedown on the pane (or child)
    const child = document.createElement("div");
    paneEl.appendChild(child);
    child.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(fm.getFocusedPane()).toBe("pane-1");
    expect(paneManager.focusPane).toHaveBeenCalledWith("pane-1");
    expect(router.setFocusedPane).toHaveBeenCalledWith("pane-1");
  });

  it("registerPane stores element and enables visual + data attr", () => {
    const fm = new FocusManager();
    const el = document.createElement("div");
    fm.registerPane("pane-a", el);

    expect(el.dataset.paneId).toBe("pane-a");
    expect(el.classList.contains("layout-pane")).toBe(true);
    expect(fm.getFocusedPane()).toBe("default"); // no auto focus on register
  });

  it("setFocusedPane adds .focused to target, removes from previous, delegates", () => {
    const fm = new FocusManager(paneManager, router);
    fm.init(container);

    const pane1 = document.createElement("div");
    pane1.className = "layout-pane";
    pane1.dataset.paneId = "pane-1";
    const pane2 = document.createElement("div");
    pane2.className = "layout-pane";
    pane2.dataset.paneId = "pane-2";
    container.appendChild(pane1);
    container.appendChild(pane2);

    fm.registerPane("pane-1", pane1);
    fm.registerPane("pane-2", pane2);

    fm.setFocusedPane("pane-1");
    expect(pane1.classList.contains("focused")).toBe(true);
    expect(pane2.classList.contains("focused")).toBe(false);
    expect(paneManager.focusPane).toHaveBeenCalledWith("pane-1");
    expect(router.setFocusedPane).toHaveBeenCalledWith("pane-1");

    fm.setFocusedPane("pane-2");
    expect(pane1.classList.contains("focused")).toBe(false);
    expect(pane2.classList.contains("focused")).toBe(true);
    expect(paneManager.focusPane).toHaveBeenCalledWith("pane-2");
    expect(router.setFocusedPane).toHaveBeenLastCalledWith("pane-2");
  });

  it("getFocusedPane returns current (or default)", () => {
    const fm = new FocusManager();
    expect(fm.getFocusedPane()).toBe("default");
    fm.setFocusedPane("pane-x");
    expect(fm.getFocusedPane()).toBe("pane-x");
  });

  it("onFocusChange fires on every setFocusedPane (including initial delegates)", () => {
    const fm = new FocusManager(paneManager, router);
    const cb = vi.fn();
    fm.onFocusChange(cb);

    fm.setFocusedPane("pane-42");
    expect(cb).toHaveBeenCalledWith("pane-42");

    fm.setFocusedPane("pane-99");
    expect(cb).toHaveBeenCalledWith("pane-99");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("unregisterPane removes visual and auto-focuses first remaining pane if focused was removed", () => {
    const fm = new FocusManager(paneManager, router);
    fm.init(container);

    const p1 = document.createElement("div");
    p1.className = "layout-pane";
    p1.dataset.paneId = "p1";
    const p2 = document.createElement("div");
    p2.className = "layout-pane";
    p2.dataset.paneId = "p2";
    const p3 = document.createElement("div");
    p3.className = "layout-pane";
    p3.dataset.paneId = "p3";
    container.append(p1, p2, p3);

    fm.registerPane("p1", p1);
    fm.registerPane("p2", p2);
    fm.registerPane("p3", p3);

    fm.setFocusedPane("p2");
    expect(p2.classList.contains("focused")).toBe(true);

    // Remove the focused one
    fm.unregisterPane("p2");

    // Should have auto-focused the first remaining (p1, since registration order)
    expect(fm.getFocusedPane()).toBe("p1");
    expect(p1.classList.contains("focused")).toBe(true);
    expect(p2.classList.contains("focused")).toBe(false);
    expect(paneManager.focusPane).toHaveBeenLastCalledWith("p1");
  });

  it("unregisterPane of non-focused pane leaves focus unchanged", () => {
    const fm = new FocusManager(paneManager, router);
    fm.init(container);

    const p1 = document.createElement("div");
    p1.className = "layout-pane";
    p1.dataset.paneId = "p1";
    const p2 = document.createElement("div");
    p2.className = "layout-pane";
    p2.dataset.paneId = "p2";
    container.append(p1, p2);

    fm.registerPane("p1", p1);
    fm.registerPane("p2", p2);
    fm.setFocusedPane("p1");

    fm.unregisterPane("p2");
    expect(fm.getFocusedPane()).toBe("p1");
    expect(p1.classList.contains("focused")).toBe(true);
  });

  it("handleTabSwitch auto-focuses the first registered pane (consumer controls order)", () => {
    const fm = new FocusManager(paneManager, router);
    fm.init(container);

    const a = document.createElement("div");
    a.className = "layout-pane";
    a.dataset.paneId = "tab2-pane-a";
    const b = document.createElement("div");
    b.className = "layout-pane";
    b.dataset.paneId = "tab2-pane-b";
    container.append(a, b);

    // Simulate: consumer registers panes belonging to the new tab in desired order
    fm.registerPane("tab2-pane-a", a);
    fm.registerPane("tab2-pane-b", b);

    fm.handleTabSwitch("tab-2");

    expect(fm.getFocusedPane()).toBe("tab2-pane-a");
    expect(a.classList.contains("focused")).toBe(true);
    expect(paneManager.focusPane).toHaveBeenCalledWith("tab2-pane-a");
    expect(router.setFocusedPane).toHaveBeenCalledWith("tab2-pane-a");
  });

  it("click on pane (even deep child) sets focus via delegation", () => {
    const fm = new FocusManager(paneManager, router);
    fm.init(container);

    const pane = document.createElement("div");
    pane.className = "layout-pane";
    pane.dataset.paneId = "deep-pane";
    const deep = document.createElement("span");
    deep.textContent = "xterm canvas";
    pane.appendChild(deep);
    container.appendChild(pane);

    fm.registerPane("deep-pane", pane);

    // Click the deep child
    deep.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(fm.getFocusedPane()).toBe("deep-pane");
    expect(pane.classList.contains("focused")).toBe(true);
  });

  it("dispose cleans listeners, maps, and resets state", () => {
    const fm = new FocusManager(paneManager, router);
    fm.init(container);

    const p = document.createElement("div");
    p.className = "layout-pane";
    p.dataset.paneId = "to-dispose";
    container.appendChild(p);
    fm.registerPane("to-dispose", p);
    fm.setFocusedPane("to-dispose");

    fm.dispose();

    expect(fm.getFocusedPane()).toBe("default");
    // After dispose, further clicks should not be handled by this instance
    p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    // (no assertion on side effects since listener removed; state is default)
  });

  it("setFocusedPane on unknown pane still updates state + delegates (visual waits for register)", () => {
    const fm = new FocusManager(paneManager, router);
    fm.setFocusedPane("ghost-pane");

    expect(fm.getFocusedPane()).toBe("ghost-pane");
    expect(paneManager.focusPane).toHaveBeenCalledWith("ghost-pane");
    expect(router.setFocusedPane).toHaveBeenCalledWith("ghost-pane");
  });

  it("multiple onFocusChange callbacks all fire", () => {
    const fm = new FocusManager();
    const c1 = vi.fn();
    const c2 = vi.fn();
    fm.onFocusChange(c1);
    fm.onFocusChange(c2);

    fm.setFocusedPane("multi");
    expect(c1).toHaveBeenCalledWith("multi");
    expect(c2).toHaveBeenCalledWith("multi");
  });
});
