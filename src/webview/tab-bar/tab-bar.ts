import type { TerminalBackendType } from "../../types";
import type { PaneManager } from "../pane-manager";
import type { PaneMessageRouter } from "../pane-message-router";

/**
 * TabBar
 * VS Code sidebar-style horizontal tab strip with:
 * - Tab items (title + close ×)
 * - "+" new tab button at end
 * - Active tab visual highlight (sunk background + focusBorder accent)
 * - Minimum 1 tab enforcement
 * - On tab switch: hide previous tab panes, show new tab panes (fit ONLY visible via PaneManager.showPane)
 * - Integrates with PaneMessageRouter for focus tracking
 *
 * Browser-only. No Node.js imports.
 */

export type TabSwitchCallback = (tabId: string) => void;
export type TabAddCallback = () => void;
export type TabCloseCallback = (tabId: string) => void;

interface TabRecord {
  title: string;
  el: HTMLDivElement;
  closeBtn: HTMLButtonElement;
}

export class TabBar {
  private readonly element: HTMLDivElement;
  private readonly tabsContainer: HTMLDivElement;
  private readonly addBtn: HTMLButtonElement;

  private readonly paneManager: PaneManager;
  private readonly messageRouter?: PaneMessageRouter;

  private readonly tabs = new Map<string, TabRecord>();
  private readonly tabPanes = new Map<string, string[]>(); // tabId -> paneIds that belong to this tab

  private activeTabId: string | null = null;

  private tabSwitchCallback?: TabSwitchCallback;
  private tabAddCallback?: TabAddCallback;
  private tabCloseCallback?: TabCloseCallback;

  constructor(paneManager: PaneManager, messageRouter?: PaneMessageRouter) {
    this.paneManager = paneManager;
    this.messageRouter = messageRouter;

    // Root bar
    this.element = document.createElement("div");
    this.element.className = "tab-bar";

    // Tabs strip
    this.tabsContainer = document.createElement("div");
    this.tabsContainer.className = "tab-bar__tabs";
    this.element.appendChild(this.tabsContainer);

    // New tab button
    this.addBtn = document.createElement("button");
    this.addBtn.className = "tab-add-btn";
    this.addBtn.type = "button";
    this.addBtn.setAttribute("aria-label", "New tab");
    this.addBtn.textContent = "+";
    this.addBtn.addEventListener("click", () => {
      this.tabAddCallback?.();
    });
    this.element.appendChild(this.addBtn);
  }

  /** Returns the root DOM element for insertion into the page. */
  getElement(): HTMLDivElement {
    return this.element;
  }

  /** Add a new tab to the bar. If this is the first tab, it becomes active automatically. */
  addTab(tabId: string, title?: string): void {
    if (this.tabs.has(tabId)) {
      // Idempotent: update title if provided
      if (title) {
        const rec = this.tabs.get(tabId)!;
        rec.title = title;
        const titleEl = rec.el.querySelector(".tab-title");
        if (titleEl) titleEl.textContent = title;
      }
      return;
    }

    const displayTitle = title ?? tabId;

    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.setAttribute("data-tab-id", tabId);
    tabEl.setAttribute("role", "tab");
    tabEl.setAttribute("aria-selected", "false");

    const iconEl = document.createElement("span");
    iconEl.className = "tab-bar__icon";
    iconEl.textContent = "$"; // Default icon

    const titleEl = document.createElement("span");
    titleEl.className = "tab-title";
    titleEl.textContent = displayTitle;

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", `Close ${displayTitle}`);
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.tabCloseCallback?.(tabId);
    });

    tabEl.appendChild(iconEl);
    tabEl.appendChild(titleEl);
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener("click", () => {
      this.switchTab(tabId);
    });

    this.tabs.set(tabId, { title: displayTitle, el: tabEl, closeBtn });
    this.tabsContainer.appendChild(tabEl);

    // Update close button visibility (only show when > 1 tab)
    this.updateCloseButtonVisibility();
    this.updateChromeVisibility();

    // First tab → auto-activate
    if (this.activeTabId === null) {
      this.switchTab(tabId);
    }
  }

  /** Remove a tab. Prevents removal if it is the last remaining tab (minimum 1). */
  removeTab(tabId: string): void {
    if (!this.tabs.has(tabId)) return;
    if (this.tabs.size <= 1) {
      // Enforce minimum 1 tab
      return;
    }

    const wasActive = this.activeTabId === tabId;
    const rec = this.tabs.get(tabId)!;

    // Remove from DOM
    rec.el.remove();
    this.tabs.delete(tabId);
    this.tabPanes.delete(tabId);

    this.updateCloseButtonVisibility();
    this.updateChromeVisibility();

    if (wasActive) {
      // Switch to another tab (prefer the first remaining)
      const nextId = this.tabs.keys().next().value as string | undefined;
      if (nextId) {
        this.switchTab(nextId);
      } else {
        this.activeTabId = null;
      }
    }
  }

  /**
   * Switch to the given tab.
   * - Visually activates the tab
   * - Hides panes belonging to previous tab (hidePane does NOT call fit)
   * - Shows panes belonging to new tab (showPane calls fitAddon.fit() ONLY for visible panes)
   * - Updates PaneMessageRouter focused pane (if provided)
   */
  switchTab(tabId: string): void {
    if (!this.tabs.has(tabId)) return;
    if (this.activeTabId === tabId) return;

    const prevId = this.activeTabId;

    // 1. Hide previous tab's panes (important: do NOT trigger fit on hidden elements - xterm #4509)
    if (prevId) {
      const prevPanes = this.tabPanes.get(prevId) ?? [];
      for (const paneId of prevPanes) {
        this.paneManager.hidePane(paneId);
      }
      const prevRec = this.tabs.get(prevId);
      if (prevRec) prevRec.el.classList.remove("active");
    }

    // 2. Show new tab's panes (showPane internally does fit() — only visible panes get fitted)
    const newPanes = this.tabPanes.get(tabId) ?? [];
    for (const paneId of newPanes) {
      this.paneManager.showPane(paneId);
    }

    // 3. Visual activation
    const newRec = this.tabs.get(tabId)!;
    newRec.el.classList.add("active");
    newRec.el.setAttribute("aria-selected", "true");

    if (prevId) {
      const prevRec = this.tabs.get(prevId);
      if (prevRec) prevRec.el.setAttribute("aria-selected", "false");
    }

    this.activeTabId = tabId;

    // 4. Focus management (first pane of the visible tab)
    if (newPanes.length > 0) {
      const firstPane = newPanes[0];
      this.paneManager.focusPane(firstPane);
      this.messageRouter?.setFocusedPane(firstPane);
    }

    this.tabSwitchCallback?.(tabId);
  }

  /** Associate which panes belong to a given tab. Must be called by consumer after creating panes for the tab. */
  setPanesForTab(tabId: string, paneIds: string[]): void {
    this.tabPanes.set(tabId, [...paneIds]);
  }

  /** Returns the currently active tab id, or null if none. */
  getActiveTab(): string | null {
    return this.activeTabId;
  }

  /** Register callback fired after a successful tab switch (including initial auto-switch). */
  onTabSwitch(callback: TabSwitchCallback): void {
    this.tabSwitchCallback = callback;
  }

  /** Register callback fired when the "+" button is clicked. Consumer should create new tab + panes then call addTab. */
  onTabAdd(callback: TabAddCallback): void {
    this.tabAddCallback = callback;
  }

  /** Register callback fired when a tab's close button is clicked. Consumer should call removeTab if appropriate. */
  onTabClose(callback: TabCloseCallback): void {
    this.tabCloseCallback = callback;
  }

  /** Number of tabs currently in the bar. */
  getTabCount(): number {
    return this.tabs.size;
  }

  /** Update the backend icon for a given tab. */
  setTabBackend(tabId: string, backend: TerminalBackendType): void {
    const rec = this.tabs.get(tabId);
    if (!rec) return;

    const icons: Record<TerminalBackendType, string> = {
      native: "$",
      tmux: "⊞",
      zellij: "◈",
    };

    const iconEl = rec.el.querySelector(".tab-bar__icon") as HTMLElement;
    if (iconEl) {
      iconEl.textContent = icons[backend] ?? "$";
    }
  }

  /** Cleanup: removes all DOM listeners and elements (does not dispose panes). */
  dispose(): void {
    // Remove all tab elements (their listeners are GC'd with the nodes)
    this.tabsContainer.innerHTML = "";
    this.tabs.clear();
    this.tabPanes.clear();
    this.activeTabId = null;

    // Remove the bar itself from DOM if it has a parent
    this.element.remove();
  }

  // --- private helpers ---

  private updateCloseButtonVisibility(): void {
    const isSingleTab = this.tabs.size <= 1;
    for (const rec of this.tabs.values()) {
      rec.closeBtn.style.display = isSingleTab ? "none" : "";
    }
  }

  private updateChromeVisibility(): void {
    this.element.classList.toggle("tab-bar--single", this.tabs.size <= 1);
  }
}
