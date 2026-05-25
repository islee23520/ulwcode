/**
 * LayoutEngine — Pure CSS Grid split-pane layout manager
 *
 * Responsibilities:
 * - Maintain a recursive PaneLayout tree
 * - Render the tree to DOM using nested CSS Grid containers
 * - Provide pointer-event based resize handles between panes
 * - Enforce minimum pane size (100px)
 * - Expose getLayout() / renderLayout() for external state sync (PaneStore)
 *
 * Design constraints (per Task 9):
 * - NO external libraries (pure DOM + CSS Grid + pointer events)
 * - Browser-only: no Node.js imports
 * - Min pane size: 100px in both axes
 * - Resize via pointer events on handles
 */

import type { PaneLayout } from "../../types";

export interface LayoutEngineOptions {
  /** Called whenever the layout tree changes (split / remove / resize) */
  onLayoutChange?: (layout: PaneLayout) => void;
  /** Minimum size in pixels for any pane (default 100) */
  minPaneSize?: number;
}

export class LayoutEngine {
  private rootContainer: HTMLElement;
  private rootNode: LayoutNode | null = null;
  private paneMap = new Map<string, LayoutNode>();
  private options: Required<LayoutEngineOptions>;
  private dragState: DragState | null = null;
  private currentTabId = "default"; // preserved across render/getLayout

  constructor(rootContainer: HTMLElement, options: LayoutEngineOptions = {}) {
    this.rootContainer = rootContainer;
    this.options = {
      onLayoutChange: options.onLayoutChange ?? (() => {}),
      minPaneSize: options.minPaneSize ?? 100,
    };

    // Ensure root has the base class
    this.rootContainer.classList.add("layout-root");
  }

  /**
   * Split an existing pane (by id) in the given direction.
   * Creates a new sibling pane.
   * Returns the id of the newly created pane.
   */
  splitPane(
    paneId: string,
    direction: "horizontal" | "vertical",
    newPaneId?: string
  ): string {
    const target = this.paneMap.get(paneId);
    if (!target) {
      throw new Error(`splitPane: pane not found: ${paneId}`);
    }
    if (target.children && target.children.length > 0) {
      // For now we only split leaves. If needed, we could split a split container.
      // Per current requirements we split the current pane.
    }

    const freshId = newPaneId ?? this.generatePaneId();

    // Create two leaf nodes
    const first: LayoutNode = {
      paneId: target.paneId,
      element: target.element,
    };
    const second: LayoutNode = {
      paneId: freshId,
    };

    // Turn target into a split container
    target.splitDirection = direction;
    target.children = [first, second];
    target.size = undefined; // sizes live on children for this level
    delete target.element; // will be replaced by a grid container

    // Create the DOM for the split
    this.renderNode(target, this.rootContainer);

    this.notifyChange();
    return freshId;
  }

  /**
   * Remove a pane by id.
   * If the pane was part of a split, the sibling takes over the space.
   * If it was the last pane, the container becomes empty.
   */
  removePane(paneId: string): void {
    const node = this.paneMap.get(paneId);
    if (!node) return;

    // Find parent in the tree
    const parentInfo = this.findParent(this.rootNode, node);
    if (!parentInfo) {
      // Removing the root pane — clear everything
      this.rootNode = null;
      this.paneMap.clear();
      this.rootContainer.innerHTML = "";
      this.notifyChange();
      return;
    }

    const { parent, index } = parentInfo;
    if (!parent.children) return;

    // Remove the node
    parent.children.splice(index, 1);

    if (parent.children.length === 1) {
      // Collapse: the remaining sibling replaces the split parent
      const survivor = parent.children[0];

      // If survivor is itself a split, we just promote it
      // If survivor is a leaf, it becomes the new content at this level

      // Replace parent's element content with survivor's rendered content
      if (parent.element) {
        parent.element.innerHTML = "";
        parent.element.className = ""; // will be re-applied during render

        // Re-render the survivor in place of the parent split
        this.renderNode(survivor, parent.element);

        // Update parent to become the survivor (promote)
        parent.paneId = survivor.paneId;
        parent.splitDirection = survivor.splitDirection;
        parent.children = survivor.children;
        parent.element = survivor.element;
      }

      // Clean up the old survivor reference in map if needed
    } else if (parent.children.length === 0) {
      // Should not happen in normal 2-way splits, but guard
      parent.children = undefined;
      parent.splitDirection = undefined;
    }

    // Re-render from root to ensure consistency
    if (this.rootNode) {
      this.renderNode(this.rootNode, this.rootContainer);
    }

    this.notifyChange();
  }

  /**
   * Begin a resize operation. Typically called from pointerdown on a handle.
   * The engine manages the full drag lifecycle internally when you use attachHandleListeners.
   * This method is exposed for advanced / test scenarios.
   */
  beginResize(
    handle: HTMLElement,
    startX: number,
    startY: number
  ): void {
    const splitContainer = handle.parentElement;
    if (!splitContainer || !splitContainer.classList.contains("layout-split")) {
      return;
    }

    const direction = handle.classList.contains("horizontal")
      ? "horizontal"
      : "vertical";

    const isHorizontal = direction === "horizontal";

    const rect = splitContainer.getBoundingClientRect();
    const totalSize = isHorizontal ? rect.width : rect.height;

    // Read current grid template to get initial ratios
    const style = getComputedStyle(splitContainer);
    const template = isHorizontal
      ? style.gridTemplateColumns
      : style.gridTemplateRows;

    this.dragState = {
      handle,
      splitContainer: splitContainer as HTMLElement,
      direction,
      startX,
      startY,
      startRect: rect,
      totalSize,
      initialTemplate: template,
      minSize: this.options.minPaneSize,
    };

    handle.classList.add("dragging");
    document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";

    // Attach global listeners (captured on document for reliability)
    const onMove = (e: PointerEvent) => this.onPointerMove(e);
    const onUp = (e: PointerEvent) => this.onPointerUp(e, onMove, onUp);

    document.addEventListener("pointermove", onMove, { capture: true });
    document.addEventListener("pointerup", onUp, { capture: true, once: true });
  }

  /** Returns the current layout tree (serializable) */
  getLayout(): PaneLayout | null {
    if (!this.rootNode) return null;
    return this.nodeToLayout(this.rootNode, this.currentTabId);
  }

  getPaneElement(paneId: string): HTMLElement | undefined {
    return this.paneMap.get(paneId)?.element;
  }

  /**
   * Replace the current layout with a new tree.
   * Useful for restoring persisted layouts from PaneStore.
   */
  renderLayout(layout: PaneLayout): void {
    this.paneMap.clear();
    this.rootContainer.innerHTML = "";

    this.currentTabId = layout.tabId || "default";
    this.rootNode = this.layoutToNode(layout);
    if (this.rootNode) {
      this.renderNode(this.rootNode, this.rootContainer);
    }
    this.notifyChange();
  }

  /** Destroy listeners and clean DOM (for hot reload / dispose) */
  dispose(): void {
    this.rootContainer.innerHTML = "";
    this.paneMap.clear();
    this.rootNode = null;
    this.dragState = null;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Internal implementation
  // ────────────────────────────────────────────────────────────────────────────

  private generatePaneId(): string {
    return `pane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private notifyChange(): void {
    const layout = this.getLayout();
    if (layout) {
      this.options.onLayoutChange(layout);
    }
  }

  private nodeToLayout(node: LayoutNode, tabId: string): PaneLayout {
    const layout: PaneLayout = {
      tabId,
      paneId: node.paneId,
    };

    if (node.splitDirection) {
      layout.splitDirection = node.splitDirection;
    }
    if (node.size !== undefined) {
      layout.size = node.size;
    }
    if (node.children && node.children.length > 0) {
      layout.children = node.children.map((child) =>
        this.nodeToLayout(child, tabId)
      );
    }
    return layout;
  }

  private layoutToNode(layout: PaneLayout): LayoutNode {
    const node: LayoutNode = {
      paneId: layout.paneId,
    };

    if (layout.splitDirection) node.splitDirection = layout.splitDirection;
    if (layout.size !== undefined) node.size = layout.size;

    if (layout.children && layout.children.length > 0) {
      node.children = layout.children.map((c) => this.layoutToNode(c));
    }

    return node;
  }

  private findParent(
    current: LayoutNode | null,
    target: LayoutNode,
    parent: LayoutNode | null = null
  ): { parent: LayoutNode; index: number } | null {
    if (!current) return null;
    if (current === target) {
      return parent ? { parent, index: -1 } : null; // root has no parent
    }
    if (current.children) {
      for (let i = 0; i < current.children.length; i++) {
        if (current.children[i] === target) {
          return { parent: current, index: i };
        }
        const deeper = this.findParent(current.children[i], target, current);
        if (deeper) return deeper;
      }
    }
    return null;
  }

  /**
   * Render a node (and its subtree) into a parent DOM element.
   * This is the core of the CSS Grid implementation.
   */
  private renderNode(node: LayoutNode, parentDom: HTMLElement): void {
    // Register in map
    this.paneMap.set(node.paneId, node);

    if (!node.children || node.children.length === 0) {
      // Leaf pane
      let el = node.element;
      if (!el) {
        el = document.createElement("div");
        el.className = "layout-pane";
        el.dataset.paneId = node.paneId;
        node.element = el;
      }
      // Clear and (re)attach if needed
      if (el.parentElement !== parentDom) {
        parentDom.appendChild(el);
      }
      return;
    }

    // Split container
    let container = node.element as HTMLElement | undefined;
    if (!container || !container.classList.contains("layout-split")) {
      container = document.createElement("div");
      container.className = "layout-split";
      node.element = container;
    }

    if (container.parentElement !== parentDom) {
      parentDom.appendChild(container);
    }

    // Clear previous children/handles
    container.innerHTML = "";

    const isHorizontal = node.splitDirection === "horizontal";

    // Set grid template based on children sizes (default 1fr each)
    const sizes = node.children.map((c) => (c.size ? `${c.size}fr` : "1fr"));
    if (isHorizontal) {
      container.style.gridTemplateColumns = sizes.join(" ");
      container.style.gridTemplateRows = "";
    } else {
      container.style.gridTemplateRows = sizes.join(" ");
      container.style.gridTemplateColumns = "";
    }

    // Render children + insert handles between them
    node.children.forEach((child, idx) => {
      this.renderNode(child, container!);

      // Insert handle after each child except the last
      if (idx < node.children!.length - 1) {
        const handle = document.createElement("div");
        handle.className = `layout-handle ${isHorizontal ? "horizontal" : "vertical"}`;
        handle.dataset.handleFor = node.paneId;
        container!.appendChild(handle);

        // Attach pointer drag behavior
        this.attachHandleListeners(handle, container!, isHorizontal);
      }
    });
  }

  private attachHandleListeners(
    handle: HTMLElement,
    splitContainer: HTMLElement,
    isHorizontal: boolean
  ): void {
    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      this.beginResize(handle, e.clientX, e.clientY);
    });

    // Also allow double-click to reset to equal sizes (nice UX)
    handle.addEventListener("dblclick", () => {
      this.resetSplitSizes(splitContainer, isHorizontal);
    });
  }

  private resetSplitSizes(
    splitContainer: HTMLElement,
    isHorizontal: boolean
  ): void {
    const children = Array.from(splitContainer.children).filter(
      (el) => el.classList.contains("layout-pane") || el.classList.contains("layout-split")
    );

    if (children.length !== 2) return;

    // Reset to equal fr
    if (isHorizontal) {
      splitContainer.style.gridTemplateColumns = "1fr 1fr";
    } else {
      splitContainer.style.gridTemplateRows = "1fr 1fr";
    }

    // Update node sizes if we can find the parent node
    // (for simplicity we re-render from root after reset in real usage)
    this.notifyChange();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragState) return;

    const { splitContainer, direction, startX, startY, totalSize, minSize } =
      this.dragState;
    const isHorizontal = direction === "horizontal";

    const currentPos = isHorizontal ? e.clientX : e.clientY;
    const startPos = isHorizontal ? startX : startY;

    const delta = currentPos - startPos;

    // Better: read current rendered sizes of the two grid areas
    const firstChild = splitContainer.firstElementChild as HTMLElement;
    const lastChild = splitContainer.lastElementChild as HTMLElement;

    if (!firstChild || !lastChild) return;

    const firstRect = firstChild.getBoundingClientRect();
    const lastRect = lastChild.getBoundingClientRect();

    let firstSize = isHorizontal ? firstRect.width : firstRect.height;
    let secondSize = isHorizontal ? lastRect.width : lastRect.height;

    // Apply delta with clamping
    firstSize = Math.max(minSize, Math.min(totalSize - minSize, firstSize + delta));
    secondSize = totalSize - firstSize;

    if (secondSize < minSize) {
      secondSize = minSize;
      firstSize = totalSize - secondSize;
    }

    // Apply to grid (use pixel values during drag for precision)
    if (isHorizontal) {
      splitContainer.style.gridTemplateColumns = `${firstSize}px ${secondSize}px`;
    } else {
      splitContainer.style.gridTemplateRows = `${firstSize}px ${secondSize}px`;
    }
  }

  private onPointerUp(
    _e: PointerEvent,
    moveHandler: (ev: PointerEvent) => void,
    _upHandler: (ev: PointerEvent) => void
  ): void {
    if (!this.dragState) return;

    const { handle, splitContainer, direction, totalSize, minSize } = this.dragState;
    const isHorizontal = direction === "horizontal";

    // Finalize: convert current pixel sizes back to fr fractions
    const firstChild = splitContainer.firstElementChild as HTMLElement;
    const lastChild = splitContainer.lastElementChild as HTMLElement;

    if (firstChild && lastChild) {
      const firstRect = firstChild.getBoundingClientRect();
      const lastRect = lastChild.getBoundingClientRect();

      let firstPx = isHorizontal ? firstRect.width : firstRect.height;
      let secondPx = isHorizontal ? lastRect.width : lastRect.height;

      // Clamp one last time
      firstPx = Math.max(minSize, Math.min(totalSize - minSize, firstPx));
      secondPx = totalSize - firstPx;

      const firstFr = firstPx / totalSize;
      const secondFr = secondPx / totalSize;

      // Store back into the node tree (find the split node)
      const splitNode = this.findSplitNodeForElement(splitContainer);
      if (splitNode && splitNode.children && splitNode.children.length === 2) {
        splitNode.children[0].size = firstFr;
        splitNode.children[1].size = secondFr;
      }

      // Switch grid to fr so it stays responsive on container resize
      if (isHorizontal) {
        splitContainer.style.gridTemplateColumns = `${firstFr}fr ${secondFr}fr`;
      } else {
        splitContainer.style.gridTemplateRows = `${firstFr}fr ${secondFr}fr`;
      }
    }

    handle.classList.remove("dragging");
    document.body.style.cursor = "";

    document.removeEventListener("pointermove", moveHandler, { capture: true });

    this.dragState = null;
    this.notifyChange();
  }

  private findSplitNodeForElement(el: HTMLElement): LayoutNode | null {
    for (const node of this.paneMap.values()) {
      if (node.element === el && node.children) {
        return node;
      }
    }
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal types (not exported)
// ──────────────────────────────────────────────────────────────────────────────

interface LayoutNode {
  paneId: string;
  splitDirection?: "horizontal" | "vertical";
  size?: number; // fraction (0-1) relative to parent split
  children?: LayoutNode[];
  element?: HTMLElement;
}

interface DragState {
  handle: HTMLElement;
  splitContainer: HTMLElement;
  direction: "horizontal" | "vertical";
  startX: number;
  startY: number;
  startRect: DOMRect;
  totalSize: number;
  initialTemplate: string;
  minSize: number;
}
