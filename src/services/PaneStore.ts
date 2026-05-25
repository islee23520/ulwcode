import { EventEmitter } from "node:events";
import type { TerminalBackendType } from "../types";

export interface PaneState {
  paneId: string;
  tabId: string;
  isActive: boolean;
  size: number;
  splitDirection?: "horizontal" | "vertical";
  cwd?: string;
  command?: string;
  backend?: TerminalBackendType;
}

export interface PaneLayoutSnapshot {
  tabs: Array<{ tabId: string; activePaneId: string }>;
  panes: PaneState[];
}

type PaneStoreEventMap = {
  change: [panes: readonly PaneState[]];
  "pane-add": [pane: PaneState];
  "pane-remove": [paneId: string];
  "pane-resize": [paneId: string, size: number];
  "pane-focus": [paneId: string];
  "tab-add": [tabId: string];
  "tab-remove": [tabId: string];
  "tab-switch": [tabId: string];
  "backendChanged": [paneId: string, oldBackend: TerminalBackendType | undefined, newBackend: TerminalBackendType];
};

export class PaneStore extends EventEmitter {
  private panes: Map<string, PaneState> = new Map();
  private activePaneId: string | null = null;
  private activeTabId: string | null = null;

  public addPane(state: PaneState): void {
    const existed = this.panes.has(state.paneId);
    const previousTabId = this.panes.get(state.paneId)?.tabId;
    const pane = this.clonePane(state);

    this.panes.set(pane.paneId, pane);

    if (!existed && !previousTabId) {
      this.emitTyped("tab-add", pane.tabId);
    } else if (previousTabId && previousTabId !== pane.tabId) {
      if (!this.panesHasTab(previousTabId)) {
        this.emitTyped("tab-remove", previousTabId);
      }
      this.emitTyped("tab-add", pane.tabId);
    } else if (!previousTabId && this.panes.size === 1) {
      this.emitTyped("tab-add", pane.tabId);
    }

    const shouldBeActive =
      pane.isActive || this.activePaneId === null || this.activePaneId === pane.paneId;

    if (shouldBeActive) {
      this.activatePaneInternal(pane.paneId, false);
    } else {
      pane.isActive = false;
      this.panes.set(pane.paneId, pane);
    }

    if (!existed) {
      this.emitTyped("pane-add", this.clonePane(pane));
    }

    this.emitTyped("change", this.getAllPanesSnapshot());
  }

  public removePane(paneId: string): void {
    const pane = this.panes.get(paneId);
    if (!pane) {
      return;
    }

    this.panes.delete(paneId);
    this.emitTyped("pane-remove", paneId);

    if (this.activePaneId === paneId) {
      this.activePaneId = null;
      this.activeTabId = null;
    }

    if (!this.panesHasTab(pane.tabId)) {
      this.emitTyped("tab-remove", pane.tabId);
    }

    this.emitTyped("change", this.getAllPanesSnapshot());
  }

  public setActivePane(paneId: string): void {
    if (!this.panes.has(paneId)) {
      throw new Error(`Cannot set active pane: unknown id '${paneId}'`);
    }

    if (this.activePaneId === paneId) {
      return;
    }

    this.activatePaneInternal(paneId, true);
  }

  public getActivePane(): PaneState | undefined {
    if (!this.activePaneId) {
      return undefined;
    }

    const pane = this.panes.get(this.activePaneId);
    return pane ? this.clonePane(pane) : undefined;
  }

  public getPanesByTab(tabId: string): PaneState[] {
    return Array.from(this.panes.values())
      .filter((pane) => pane.tabId === tabId)
      .map((pane) => this.clonePane(pane));
  }

  public getActiveTab(): string | null {
    return this.activeTabId;
  }

  public getPanesByBackend(backend: TerminalBackendType): PaneState[] {
    return Array.from(this.panes.values())
      .filter((pane) => (pane.backend ?? "native") === backend)
      .map((pane) => this.clonePane(pane));
  }

  public switchPaneBackend(paneId: string, newBackend: TerminalBackendType): void {
    const pane = this.panes.get(paneId);
    if (!pane) {
      throw new Error(`Cannot switch backend: unknown pane '${paneId}'`);
    }

    const oldBackend = pane.backend;
    if (oldBackend === newBackend) {
      return;
    }

    pane.backend = newBackend;
    this.panes.set(paneId, pane);
    this.emitTyped("backendChanged", paneId, oldBackend, newBackend);
    this.emitTyped("change", this.getAllPanesSnapshot());
  }

  public getAllPanes(): Map<string, PaneState> {
    const copy = new Map<string, PaneState>();
    for (const [paneId, pane] of this.panes.entries()) {
      copy.set(paneId, this.clonePane(pane));
    }
    return copy;
  }

  public getPane(paneId: string): PaneState | undefined {
    const pane = this.panes.get(paneId);
    return pane ? this.clonePane(pane) : undefined;
  }

  public updatePaneSize(paneId: string, size: number): void {
    const pane = this.panes.get(paneId);
    if (!pane) {
      throw new Error(`Cannot update pane size: unknown id '${paneId}'`);
    }

    pane.size = size;
    this.panes.set(paneId, pane);
    this.emitTyped("pane-resize", paneId, size);
    this.emitTyped("change", this.getAllPanesSnapshot());
  }

  public dispose(): void {
    this.panes.clear();
    this.activePaneId = null;
    this.activeTabId = null;
    this.removeAllListeners();
  }

  private activatePaneInternal(paneId: string, emitFocusEvents: boolean): void {
    const nextPane = this.panes.get(paneId);
    if (!nextPane) {
      throw new Error(`Cannot activate pane: unknown id '${paneId}'`);
    }

    const previousTabId = this.activeTabId;

    for (const pane of this.panes.values()) {
      pane.isActive = pane.paneId === paneId;
    }

    this.activePaneId = paneId;
    this.activeTabId = nextPane.tabId;

    if (emitFocusEvents) {
      this.emitTyped("pane-focus", paneId);
    }

    if (previousTabId !== this.activeTabId) {
      this.emitTyped("tab-switch", nextPane.tabId);
    }
  }

  private panesHasTab(tabId: string): boolean {
    for (const pane of this.panes.values()) {
      if (pane.tabId === tabId) {
        return true;
      }
    }
    return false;
  }

  private getAllPanesSnapshot(): readonly PaneState[] {
    return Array.from(this.panes.values(), (pane) => this.clonePane(pane));
  }

  private clonePane(pane?: PaneState): PaneState {
    if (!pane) {
      throw new Error("Cannot clone missing pane state");
    }

    return {
      paneId: pane.paneId,
      tabId: pane.tabId,
      isActive: pane.isActive,
      size: pane.size,
      splitDirection: pane.splitDirection,
      cwd: pane.cwd,
      command: pane.command,
      backend: pane.backend,
    };
  }

  private emitTyped<K extends keyof PaneStoreEventMap>(
    event: K,
    ...args: PaneStoreEventMap[K]
  ): void {
    this.emit(event, ...args);
  }
}
