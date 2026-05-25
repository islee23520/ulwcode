// Browser-only. No Node.js imports.
import type { LayoutEngine } from "../layout/layout-engine";
import type { PaneManager } from "../pane-manager";
import { postMessage } from "../shared/vscode-api";

export interface PaneActionsOptions {
  layoutEngine: LayoutEngine;
  paneManager: PaneManager;
  /** Returns the currently focused pane id (used as split source) */
  getFocusedPaneId: () => string;
  /** Returns the number of panes currently visible in the active tab (used to guard last-pane close) */
  getCurrentPaneCount: () => number;
  /** Optional: root element that contains the layout (for finding newly created pane containers) */
  getLayoutRoot?: () => HTMLElement;
}

export interface PaneActionButtons {
  splitHorizontal: HTMLButtonElement;
  splitVertical: HTMLButtonElement;
  closePane: HTMLButtonElement;
}

/**
 * PaneActions
 * Provides toolbar buttons + imperative API for creating/deleting panes.
 * - Wires LayoutEngine (DOM split) + PaneManager (xterm lifecycle)
 * - Posts WebviewMessage to host for PTY/session management
 * - Enforces minimum 1 pane per tab (prevents closing the last pane)
 */
export class PaneActions {
  private readonly layoutEngine: LayoutEngine;
  private readonly paneManager: PaneManager;
  private readonly getFocusedPaneId: () => string;
  private readonly getCurrentPaneCount: () => number;
  private readonly getLayoutRoot: () => HTMLElement;

  private readonly btnSplitH: HTMLButtonElement;
  private readonly btnSplitV: HTMLButtonElement;
  private readonly btnClose: HTMLButtonElement;

  private toolbarEl: HTMLDivElement | null = null;
  private disposed = false;

  constructor(options: PaneActionsOptions) {
    this.layoutEngine = options.layoutEngine;
    this.paneManager = options.paneManager;
    this.getFocusedPaneId = options.getFocusedPaneId;
    this.getCurrentPaneCount = options.getCurrentPaneCount;
    this.getLayoutRoot = options.getLayoutRoot ?? (() => document.body);

    // Create buttons (do not attach to DOM yet)
    this.btnSplitH = this.createButton("split-h", "Split horizontal", "⫘", () => this.onSplitHorizontal());
    this.btnSplitV = this.createButton("split-v", "Split vertical", "⫙", () => this.onSplitVertical());
    this.btnClose = this.createButton("close", "Close pane", "×", () => this.onClosePane());
    this.btnClose.classList.add("pane-action-btn--danger");

    // Initial state
    this.refreshButtonStates();
  }

  /**
   * Optionally render the toolbar into a container.
   * If no container is provided, buttons are still created and can be retrieved via getActionButtons().
   */
  init(container?: HTMLElement): void {
    if (this.disposed) return;

    if (this.toolbarEl) {
      // Already initialized — just move if needed
      if (container && this.toolbarEl.parentElement !== container) {
        container.appendChild(this.toolbarEl);
      }
      return;
    }

    this.toolbarEl = document.createElement("div");
    this.toolbarEl.className = "pane-actions-toolbar";
    this.toolbarEl.appendChild(this.btnSplitH);
    this.toolbarEl.appendChild(this.btnSplitV);
    this.toolbarEl.appendChild(this.btnClose);

    if (container) {
      container.appendChild(this.toolbarEl);
    }

    this.refreshButtonStates();
  }

  /** Returns the three action buttons for external wiring (e.g. into existing toolbar) */
  getActionButtons(): PaneActionButtons {
    return {
      splitHorizontal: this.btnSplitH,
      splitVertical: this.btnSplitV,
      closePane: this.btnClose,
    };
  }

  /**
   * Programmatic split. Returns the new pane id or null if no focused pane.
   * Also posts "paneCreate" to host.
   */
  createPane(direction: "horizontal" | "vertical" = "horizontal"): string | null {
    if (this.disposed) return null;

    const focused = this.getFocusedPaneId();
    if (!focused) return null;

    // LayoutEngine creates the DOM split and returns the new pane id
    const newPaneId = this.layoutEngine.splitPane(focused, direction);

    // Wire xterm instance into the newly created .layout-pane container
    const container = this.findPaneContainer(newPaneId);
    if (container) {
      this.paneManager.createPane(newPaneId, container);
    }

    // Notify host (host will create PTY + session)
    postMessage({
      type: "paneCreate",
      paneId: newPaneId,
      direction,
    });

    this.refreshButtonStates();
    return newPaneId;
  }

  /**
   * Programmatic close. Returns true if the pane was closed.
   * Prevents closing the last remaining pane in the tab.
   * Also posts "paneDelete" to host.
   */
  deletePane(paneId: string): boolean {
    if (this.disposed) return false;
    if (!paneId) return false;

    const count = this.getCurrentPaneCount();
    if (count <= 1) {
      // Never allow closing the last pane
      return false;
    }

    // Remove from layout (DOM + tree)
    this.layoutEngine.removePane(paneId);

    // Dispose xterm instance
    this.paneManager.disposePane(paneId);

    // Notify host (host destroys PTY/session)
    postMessage({
      type: "paneDelete",
      paneId,
    });

    this.refreshButtonStates();
    return true;
  }

  /** Update disabled states based on current pane count */
  refreshButtonStates(): void {
    if (this.disposed) return;

    const count = this.getCurrentPaneCount();
    const canClose = count > 1;

    this.btnClose.disabled = !canClose;
    this.btnClose.setAttribute("aria-disabled", String(!canClose));

    // Split buttons are always enabled when we have at least one pane
    const hasPane = count >= 1;
    this.btnSplitH.disabled = !hasPane;
    this.btnSplitV.disabled = !hasPane;
  }

  /** Cleanup */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Remove toolbar from DOM if we own it
    if (this.toolbarEl && this.toolbarEl.parentElement) {
      this.toolbarEl.parentElement.removeChild(this.toolbarEl);
    }
    this.toolbarEl = null;

    // Buttons are left in memory; GC will collect once no external refs remain
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Internal button handlers (also exposed for direct calls if needed)
  // ────────────────────────────────────────────────────────────────────────────

  onSplitHorizontal(): void {
    this.createPane("horizontal");
  }

  onSplitVertical(): void {
    this.createPane("vertical");
  }

  onClosePane(paneId?: string): void {
    const target = paneId ?? this.getFocusedPaneId();
    if (target) {
      this.deletePane(target);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  private createButton(
    name: string,
    title: string,
    iconText: string,
    handler: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pane-action-btn";
    btn.dataset.action = name;
    btn.title = title;
    btn.setAttribute("aria-label", title);

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = iconText;
    btn.appendChild(icon);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!btn.disabled) {
        handler();
      }
    });

    return btn;
  }

  private findPaneContainer(paneId: string): HTMLElement | null {
    const root = this.getLayoutRoot();
    // Query the specific pane that LayoutEngine just created
    return root.querySelector<HTMLElement>(`.layout-pane[data-pane-id="${paneId}"]`);
  }
}
