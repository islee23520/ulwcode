// @vitest-environment jsdom

/**
 * PaneActions tests
 * Verifies toolbar buttons, split/close behavior, last-pane guard,
 * LayoutEngine + PaneManager wiring, and host messaging.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneActions } from "../pane-actions/pane-actions";
import { LayoutEngine } from "../layout/layout-engine";
import type { PaneManager } from "../pane-manager";
import { postMessage } from "../shared/vscode-api";
import type { PaneLayout } from "../../types";

// Mock the host messaging bridge (browser-only, no real acquireVsCodeApi in tests)
vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
}));

function createMockPaneManager(): PaneManager {
  return {
    createPane: vi.fn(),
    disposePane: vi.fn(),
    writeData: vi.fn(),
    resizePane: vi.fn(),
    focusPane: vi.fn(),
    showPane: vi.fn(),
    hidePane: vi.fn(),
    getPane: vi.fn(),
    getAllPaneIds: vi.fn(() => []),
    dispose: vi.fn(),
  } as unknown as PaneManager;
}

describe("PaneActions", () => {
  let container: HTMLElement;
  let layoutEngine: LayoutEngine;
  let mockPaneManager: PaneManager;
  let layoutChanges: PaneLayout[];
  let focusedPaneId = "root";
  let paneCount = 1;

  beforeEach(() => {
    vi.clearAllMocks();

    container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "600px";
    document.body.appendChild(container);

    layoutChanges = [];
    layoutEngine = new LayoutEngine(container, {
      onLayoutChange: (layout) => layoutChanges.push(layout),
    });

    mockPaneManager = createMockPaneManager();

    // Seed a single root pane so splits have something to attach to
    layoutEngine.renderLayout({ tabId: "tab-1", paneId: "root" });
    focusedPaneId = "root";
    paneCount = 1;
  });

  afterEach(() => {
    layoutEngine.dispose();
    container.remove();
  });

  function makePaneActions() {
    return new PaneActions({
      layoutEngine,
      paneManager: mockPaneManager,
      getFocusedPaneId: () => focusedPaneId,
      getCurrentPaneCount: () => paneCount,
      getLayoutRoot: () => container,
    });
  }

  it("creates toolbar with three buttons when init(container) is called", () => {
    const actions = makePaneActions();
    const toolbarHost = document.createElement("div");
    actions.init(toolbarHost);

    const toolbar = toolbarHost.querySelector(".pane-actions-toolbar");
    expect(toolbar).toBeTruthy();

    const buttons = toolbarHost.querySelectorAll<HTMLButtonElement>("button.pane-action-btn");
    expect(buttons.length).toBe(3);

    const [h, v, close] = Array.from(buttons);
    expect(h.title).toMatch(/horizontal/i);
    expect(v.title).toMatch(/vertical/i);
    expect(close.title).toMatch(/close/i);
    expect(close.classList.contains("pane-action-btn--danger")).toBe(true);
  });

  it("getActionButtons returns the three button elements even without init", () => {
    const actions = makePaneActions();
    const btns = actions.getActionButtons();

    expect(btns.splitHorizontal).toBeInstanceOf(HTMLButtonElement);
    expect(btns.splitVertical).toBeInstanceOf(HTMLButtonElement);
    expect(btns.closePane).toBeInstanceOf(HTMLButtonElement);
  });

  it("createPane(horizontal) splits via LayoutEngine, wires PaneManager, and posts paneCreate", () => {
    const actions = makePaneActions();

    const newId = actions.createPane("horizontal");

    expect(newId).toMatch(/^pane-/);
    expect(layoutEngine.getLayout()?.children?.length).toBe(2);
    expect(layoutEngine.getLayout()?.splitDirection).toBe("horizontal");

    // PaneManager received the new container
    expect(mockPaneManager.createPane).toHaveBeenCalledWith(newId, expect.any(HTMLElement));

    // Host was notified
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "paneCreate",
        paneId: newId,
        direction: "horizontal",
      }),
    );
  });

  it("createPane(vertical) works and posts correct direction", () => {
    const actions = makePaneActions();
    actions.createPane("vertical");

    expect(layoutEngine.getLayout()?.splitDirection).toBe("vertical");
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "paneCreate", direction: "vertical" }),
    );
  });

  it("deletePane removes from LayoutEngine + PaneManager and posts paneDelete (when >1 pane)", () => {
    const actions = makePaneActions();

    // First create a sibling
    const sibling = actions.createPane("horizontal");
    paneCount = 2; // simulate external state update

    const deleted = actions.deletePane(sibling!);

    expect(deleted).toBe(true);
    expect(mockPaneManager.disposePane).toHaveBeenCalledWith(sibling);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "paneDelete", paneId: sibling }),
    );

    // After deletion we should be back to 1 pane in layout
    const layout = layoutEngine.getLayout();
    expect(layout?.children).toBeUndefined(); // collapsed back to single leaf
  });

  it("deletePane returns false and does nothing when it would close the last pane", () => {
    const actions = makePaneActions();
    paneCount = 1;

    const result = actions.deletePane("root");

    expect(result).toBe(false);
    expect(mockPaneManager.disposePane).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "paneDelete" }),
    );
  });

  it("close button is disabled when only one pane exists", () => {
    const actions = makePaneActions();
    paneCount = 1;
    actions.refreshButtonStates();

    const btns = actions.getActionButtons();
    expect(btns.closePane.disabled).toBe(true);
  });

  it("close button becomes enabled after a split increases pane count", () => {
    const actions = makePaneActions();
    paneCount = 1;
    actions.refreshButtonStates();

    // Simulate split happening externally
    actions.createPane("horizontal");
    paneCount = 2;
    actions.refreshButtonStates();

    const btns = actions.getActionButtons();
    expect(btns.closePane.disabled).toBe(false);
  });

  it("clicking split buttons calls the corresponding createPane path", () => {
    const actions = makePaneActions();
    const btns = actions.getActionButtons();

    btns.splitHorizontal.click();
    expect(layoutEngine.getLayout()?.splitDirection).toBe("horizontal");

    // Create another split from the new pane
    focusedPaneId = layoutEngine.getLayout()!.children![1].paneId;
    btns.splitVertical.click();

    const layout = layoutEngine.getLayout();
    expect(layout?.children?.[1]?.splitDirection).toBe("vertical");
  });

  it("clicking close button calls deletePane on focused pane (when allowed)", () => {
    const actions = makePaneActions();
    const btns = actions.getActionButtons();

    // Split first so close is legal
    const sibling = actions.createPane("horizontal");
    paneCount = 2;
    actions.refreshButtonStates();

    // Focus the sibling and click close
    focusedPaneId = sibling!;
    btns.closePane.click();

    expect(mockPaneManager.disposePane).toHaveBeenCalledWith(sibling);
  });

  it("dispose removes the toolbar element from its parent", () => {
    const actions = makePaneActions();
    const host = document.createElement("div");
    actions.init(host);

    expect(host.querySelector(".pane-actions-toolbar")).toBeTruthy();

    actions.dispose();

    expect(host.querySelector(".pane-actions-toolbar")).toBeNull();
  });
});
