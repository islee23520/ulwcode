// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TabBar } from "../tab-bar/tab-bar";
import type { PaneManager } from "../pane-manager";
import type { PaneMessageRouter } from "../pane-message-router";

interface MockPaneManager {
  showPane: ReturnType<typeof vi.fn>;
  hidePane: ReturnType<typeof vi.fn>;
  focusPane: ReturnType<typeof vi.fn>;
  // We track "fit" calls conceptually via a separate spy the TabBar doesn't call directly.
  // Real PaneManager.showPane calls fit internally; our mock records "effective fits".
  effectiveFits: string[];
}

function createMockPaneManager(): MockPaneManager & PaneManager {
  const effectiveFits: string[] = [];

  const showPane = vi.fn((paneId: string) => {
    // Simulate real behavior: showPane calls fit on the visible pane
    effectiveFits.push(paneId);
  });

  const hidePane = vi.fn((_paneId: string) => {
    // hidePane must NOT push to effectiveFits
  });

  const focusPane = vi.fn();

  return {
    showPane,
    hidePane,
    focusPane,
    effectiveFits,
    // Stubs for the rest of PaneManager interface (not used by TabBar)
    createPane: vi.fn(),
    disposePane: vi.fn(),
    writeData: vi.fn(),
    resizePane: vi.fn(),
    getPane: vi.fn(),
    getAllPaneIds: vi.fn(() => []),
    dispose: vi.fn(),
  } as unknown as MockPaneManager & PaneManager;
}

function createMockRouter() {
  return {
    setFocusedPane: vi.fn(),
    getFocusedPane: vi.fn(() => "default"),
    resolvePaneId: vi.fn((id?: string) => id || "default"),
    handleHostMessage: vi.fn(),
    injectPaneId: vi.fn((m: any) => m),
  } as unknown as PaneMessageRouter;
}

describe("TabBar", () => {
  let paneManager: MockPaneManager & PaneManager;
  let router: PaneMessageRouter;

  beforeEach(() => {
    paneManager = createMockPaneManager();
    router = createMockRouter();
    vi.clearAllMocks();
  });

  it("renders a tab bar container with add button", () => {
    const bar = new TabBar(paneManager);
    const el = bar.getElement();

    expect(el.classList.contains("tab-bar")).toBe(true);
    expect(el.querySelector(".tab-add-btn")).not.toBeNull();
    expect(el.querySelector(".tab-bar__tabs")).not.toBeNull();
  });

  it("addTab creates visible tab with title and close button", () => {
    const bar = new TabBar(paneManager);
    bar.addTab("tab-1", "First Tab");

    const tabEl = bar.getElement().querySelector('[data-tab-id="tab-1"]');
    expect(tabEl).not.toBeNull();
    expect(tabEl!.querySelector(".tab-bar__icon")).not.toBeNull();
    expect(tabEl!.querySelector(".tab-bar__icon")?.textContent).toBe("$"); // Default
    expect(tabEl!.querySelector(".tab-title")?.textContent).toBe("First Tab");
    expect(tabEl!.querySelector(".tab-close")).not.toBeNull();
  });

  it("hides chrome for a single tab and restores it for multiple tabs", () => {
    const bar = new TabBar(paneManager);
    bar.addTab("tab-1", "First Tab");

    expect(bar.getElement().classList.contains("tab-bar--single")).toBe(true);

    bar.addTab("tab-2", "Second Tab");

    expect(bar.getElement().classList.contains("tab-bar--single")).toBe(false);
  });

  it("setTabBackend updates the icon for an existing tab", () => {
    const bar = new TabBar(paneManager);
    bar.addTab("tab-1", "Tab 1");

    const iconEl = bar.getElement().querySelector('[data-tab-id="tab-1"] .tab-bar__icon') as HTMLElement;
    expect(iconEl.textContent).toBe("$");

    bar.setTabBackend("tab-1", "tmux");
    expect(iconEl.textContent).toBe("⊞");

    bar.setTabBackend("tab-1", "zellij");
    expect(iconEl.textContent).toBe("◈");

    bar.setTabBackend("tab-1", "native");
    expect(iconEl.textContent).toBe("$");
  });

  it("first added tab becomes active and calls switch", () => {
    const bar = new TabBar(paneManager);
    const switchSpy = vi.fn();
    bar.onTabSwitch(switchSpy);

    bar.addTab("tab-a", "A");

    expect(bar.getActiveTab()).toBe("tab-a");
    expect(switchSpy).toHaveBeenCalledWith("tab-a");
    expect(bar.getElement().querySelector('[data-tab-id="tab-a"]')?.classList.contains("active")).toBe(true);
  });

  it("clicking a tab switches to it and fires onTabSwitch", () => {
    const bar = new TabBar(paneManager);
    const switchSpy = vi.fn();
    bar.onTabSwitch(switchSpy);

    bar.addTab("tab-1", "One");
    bar.addTab("tab-2", "Two");

    const tab2 = bar.getElement().querySelector('[data-tab-id="tab-2"]') as HTMLDivElement;
    tab2.click();

    expect(bar.getActiveTab()).toBe("tab-2");
    expect(switchSpy).toHaveBeenLastCalledWith("tab-2");
  });

  it("switchTab hides previous tab panes and shows new tab panes (fit only on visible)", () => {
    const bar = new TabBar(paneManager);

    // Set panes BEFORE adding the first tab so the auto-switch on addTab actually shows them
    bar.setPanesForTab("tab-x", ["pane-x1", "pane-x2"]);
    bar.addTab("tab-x");

    bar.addTab("tab-y");
    bar.setPanesForTab("tab-y", ["pane-y1"]);

    // Initial state: tab-x is active, its panes were shown during auto-switch (fits recorded)
    expect(paneManager.showPane).toHaveBeenCalledWith("pane-x1");
    expect(paneManager.showPane).toHaveBeenCalledWith("pane-x2");

    const initialFits = [...paneManager.effectiveFits];

    // Switch to y
    bar.switchTab("tab-y");

    // Previous panes hidden (hidePane must NOT record fits)
    expect(paneManager.hidePane).toHaveBeenCalledWith("pane-x1");
    expect(paneManager.hidePane).toHaveBeenCalledWith("pane-x2");

    // New panes shown (showPane records the fit for visible only)
    expect(paneManager.showPane).toHaveBeenCalledWith("pane-y1");

    // Critical assertion (xterm.js #4509): only the newly visible pane(s) had fit() called during this switch
    const fitsDuringSwitch = paneManager.effectiveFits.slice(initialFits.length);
    expect(fitsDuringSwitch).toEqual(["pane-y1"]);
    expect(fitsDuringSwitch).not.toContain("pane-x1");
    expect(fitsDuringSwitch).not.toContain("pane-x2");
  });

  it("removeTab prevents closing the last remaining tab", () => {
    const bar = new TabBar(paneManager);
    bar.addTab("only-one", "Solo");

    const closeSpy = vi.fn();
    bar.onTabClose(closeSpy);

    // Simulate user clicking close
    const closeBtn = bar.getElement().querySelector(".tab-close") as HTMLButtonElement;
    closeBtn.click();

    expect(closeSpy).toHaveBeenCalledWith("only-one");

    // removeTab itself must refuse
    bar.removeTab("only-one");

    expect(bar.getTabCount()).toBe(1);
    expect(bar.getActiveTab()).toBe("only-one");
  });

  it("closing a non-last tab removes it and switches if it was active", () => {
    const bar = new TabBar(paneManager);
    bar.addTab("t1", "T1");
    bar.addTab("t2", "T2");
    bar.setPanesForTab("t1", ["p1"]);
    bar.setPanesForTab("t2", ["p2"]);

    bar.switchTab("t2");
    expect(bar.getActiveTab()).toBe("t2");

    bar.removeTab("t2");

    expect(bar.getTabCount()).toBe(1);
    expect(bar.getActiveTab()).toBe("t1");
    // When removing active, it should have shown t1 panes again
    expect(paneManager.showPane).toHaveBeenCalledWith("p1");
  });

  it("onTabAdd is fired when + button is clicked", () => {
    const bar = new TabBar(paneManager);
    const addSpy = vi.fn();
    bar.onTabAdd(addSpy);

    const addBtn = bar.getElement().querySelector(".tab-add-btn") as HTMLButtonElement;
    addBtn.click();

    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it("setPanesForTab + switchTab updates router focused pane", () => {
    const bar = new TabBar(paneManager, router);
    bar.addTab("alpha");
    bar.setPanesForTab("alpha", ["pane-alpha-main"]);

    bar.addTab("beta");
    bar.setPanesForTab("beta", ["pane-beta-1", "pane-beta-2"]);

    bar.switchTab("beta");

    expect(router.setFocusedPane).toHaveBeenCalledWith("pane-beta-1");
    expect(paneManager.focusPane).toHaveBeenCalledWith("pane-beta-1");
  });

  it("getActiveTab and getTabCount work correctly", () => {
    const bar = new TabBar(paneManager);
    expect(bar.getActiveTab()).toBeNull();
    expect(bar.getTabCount()).toBe(0);

    bar.addTab("a");
    bar.addTab("b");

    expect(bar.getTabCount()).toBe(2);
    expect(bar.getActiveTab()).toBe("a");
  });

  it("dispose cleans up DOM and internal state", () => {
    const bar = new TabBar(paneManager);
    bar.addTab("x");
    bar.addTab("y");

    const el = bar.getElement();
    document.body.appendChild(el);

    bar.dispose();

    expect(el.parentNode).toBeNull();
    expect(bar.getTabCount()).toBe(0);
    expect(bar.getActiveTab()).toBeNull();
  });
});
