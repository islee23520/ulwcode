import type { PaneManager } from "../pane-manager";
import type { PaneMessageRouter } from "../pane-message-router";

/**
 * FocusManager — Click-to-focus + keyboard focus routing for multi-pane terminals
 *
 * - Manages .focused class on .layout-pane elements (visual indicator via focusBorder token)
 * - Delegates xterm focus via PaneManager.focusPane()
 * - Updates routing via PaneMessageRouter.setFocusedPane()
 * - Event delegation on container for mousedown (early capture before xterm)
 * - register/unregister for dynamic LayoutEngine panes
 * - Auto re-focus first remaining pane on removal of focused pane
 * - handleTabSwitch: auto-focus first registered pane (consumer controls registration order per tab)
 * - onFocusChange for observers (e.g. future PaneStore sync)
 *
 * Browser-only. No Node.js imports. Follows webview AGENTS.md conventions.
 */
export type FocusChangeCallback = (paneId: string) => void;

export class FocusManager {
  private container: HTMLElement | null = null;
  private focusedPaneId: string = "default";
  private readonly registeredPanes = new Map<string, HTMLElement>();
  private readonly registeredOrder: string[] = [];
  private readonly focusChangeCallbacks: FocusChangeCallback[] = [];

  private readonly paneManager?: PaneManager;
  private readonly messageRouter?: PaneMessageRouter;

  constructor(
    paneManager?: PaneManager,
    messageRouter?: PaneMessageRouter,
  ) {
    this.paneManager = paneManager;
    this.messageRouter = messageRouter;
  }

  /**
   * Initialize with root container. Sets up event delegation for pane clicks.
   * Safe to call once; subsequent calls are no-ops for listener.
   */
  init(container: HTMLElement): void {
    if (this.container) {
      return;
    }
    this.container = container;
    // Capture phase for mousedown so we focus before xterm or other handlers
    container.addEventListener("mousedown", this.handleContainerMouseDown, true);
  }

  private readonly handleContainerMouseDown = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement | null)?.closest?.(
      ".layout-pane",
    ) as HTMLElement | null;
    if (target?.dataset.paneId) {
      this.setFocusedPane(target.dataset.paneId);
    }
  };

  /**
   * Register a pane element (called by LayoutEngine consumer after render).
   * Ensures data attribute and enables click-to-focus + visual tracking.
   */
  registerPane(paneId: string, element: HTMLElement): void {
    if (!paneId) return;

    this.registeredPanes.set(paneId, element);

    if (!this.registeredOrder.includes(paneId)) {
      this.registeredOrder.push(paneId);
    }

    // Ensure the element carries the expected attribute for delegation + CSS
    if (!element.dataset.paneId) {
      element.dataset.paneId = paneId;
    }
    if (!element.classList.contains("layout-pane")) {
      element.classList.add("layout-pane");
    }
  }

  /**
   * Unregister a pane (on removePane from LayoutEngine).
   * If it was focused, automatically focuses the first remaining registered pane.
   */
  unregisterPane(paneId: string): void {
    if (!paneId) return;

    this.registeredPanes.delete(paneId);
    const orderIndex = this.registeredOrder.indexOf(paneId);
    if (orderIndex !== -1) {
      this.registeredOrder.splice(orderIndex, 1);
    }

    // Remove visual state if present (query is robust even if element already detached)
    if (this.container) {
      const el = this.container.querySelector(
        `.layout-pane[data-pane-id="${paneId}"]`,
      );
      el?.classList.remove("focused");
    }

    if (this.focusedPaneId === paneId) {
      if (this.registeredOrder.length > 0) {
        // Auto-focus first remaining (preserves "first in tab" if consumer re-registers in order)
        this.setFocusedPane(this.registeredOrder[0]);
      } else {
        // No panes left — fall back to default (router will resolve)
        this.focusedPaneId = "default";
        this.notifyFocusChange("default");
      }
    }
  }

  /**
   * Set the focused pane:
   * - Updates visual .focused class (removes from previous)
   * - Calls PaneManager.focusPane() → xterm.focus() (keyboard input target)
   * - Notifies PaneMessageRouter.setFocusedPane() for data routing
   * - Fires onFocusChange callbacks
   */
  setFocusedPane(paneId: string): void {
    const resolvedId = paneId || "default";
    if (this.focusedPaneId === resolvedId) {
      // Still ensure delegates are called (e.g. re-focus xterm after hide/show)
      this.paneManager?.focusPane(resolvedId);
      this.messageRouter?.setFocusedPane(resolvedId);
      return;
    }

    // Remove previous visual
    if (this.container) {
      const prev = this.container.querySelector(".layout-pane.focused");
      prev?.classList.remove("focused");
    } else {
      // Fallback when no container yet
      for (const el of this.registeredPanes.values()) {
        el.classList.remove("focused");
      }
    }

    // Add new visual (if element exists in DOM or registered)
    let targetEl: HTMLElement | undefined | null;
    if (this.container) {
      targetEl = this.container.querySelector(
        `.layout-pane[data-pane-id="${resolvedId}"]`,
      ) as HTMLElement | null;
    }
    if (!targetEl) {
      targetEl = this.registeredPanes.get(resolvedId);
    }
    if (targetEl) {
      targetEl.classList.add("focused");
    }

    this.focusedPaneId = resolvedId;

    // Delegate to existing systems (do NOT call fit here — per spec)
    this.paneManager?.focusPane(resolvedId);
    this.messageRouter?.setFocusedPane(resolvedId);

    this.notifyFocusChange(resolvedId);
  }

  /** Returns the currently focused pane id (never null, falls back to "default") */
  getFocusedPane(): string {
    return this.focusedPaneId;
  }

  /** Subscribe to focus changes. Multiple callbacks supported. */
  onFocusChange(callback: FocusChangeCallback): void {
    if (typeof callback === "function") {
      this.focusChangeCallbacks.push(callback);
    }
  }

  /**
   * Called on tab switch (e.g. from TabBar).
   * Auto-focuses the first pane in registration order (consumer is responsible
   * for registering only the panes belonging to the newly visible tab before calling this).
   */
  handleTabSwitch(_tabId: string): void {
    if (this.registeredOrder.length > 0) {
      this.setFocusedPane(this.registeredOrder[0]);
    }
  }

  /** Cleanup listeners and state (for hot reload / dispose) */
  dispose(): void {
    if (this.container) {
      this.container.removeEventListener(
        "mousedown",
        this.handleContainerMouseDown,
        true,
      );
    }
    this.registeredPanes.clear();
    this.registeredOrder.length = 0;
    this.focusChangeCallbacks.length = 0;
    this.container = null;
    this.focusedPaneId = "default";
  }

  private notifyFocusChange(paneId: string): void {
    for (const callback of this.focusChangeCallbacks) {
      try {
        callback(paneId);
      } catch (err) {
        // Never let observer errors break focus routing
        console.warn("[FocusManager] onFocusChange callback error:", err);
      }
    }
  }
}
