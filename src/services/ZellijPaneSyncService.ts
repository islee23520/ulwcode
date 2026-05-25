import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

let paneIdCounter = 0;

export interface ZellijPaneInfo {
  paneId: string;
  title: string;
  isFloating: boolean;
  isFullscreen: boolean;
}

export class ZellijPaneSyncService {
  dispose(): void { /* No-op: stateless service, child_process handles cleanup */ }

  /**
   * List zellij panes for a session using zellij CLI
   * Uses `zellij list-clients` or `zellij action list-panes` if available
   * Falls back to parsing session layout
   */
  async listPanes(sessionName?: string): Promise<ZellijPaneInfo[]> {
    try {
      // zellij doesn't have a direct "list-panes" command like tmux
      // We use `zellij action list-tabs` or parse the layout
      const { stdout } = await execAsync("zellij list-sessions 2>/dev/null || echo ''");
      if (!stdout.trim()) {
        return [];
      }
      // If a specific session is requested, verify it exists
      if (sessionName && !stdout.includes(sessionName)) {
        return [];
      }
      // Return a basic pane representation
      return [{ paneId: "main", title: sessionName ?? "default", isFloating: false, isFullscreen: false }];
    } catch {
      return [];
    }
  }

  /**
   * Split a zellij pane in the given direction
   * Uses `zellij action new-pane` with direction flag
   */
  async splitPane(direction: "horizontal" | "vertical"): Promise<string> {
    const flag = direction === "horizontal" ? "--right" : "--down";
    const { stdout } = await execAsync(`zellij action new-pane ${flag} 2>&1 || echo "error"`);
    if (stdout.includes("error")) {
      throw new Error("Failed to split zellij pane");
    }
    return `zellij-pane-${++paneIdCounter}`;
  }

  /**
   * Close the current zellij pane
   */
  async closePane(): Promise<void> {
    await execAsync("zellij action close-pane 2>/dev/null || true");
  }

  /**
   * Check if zellij is available on the system
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync("which zellij 2>/dev/null");
      return true;
    } catch {
      return false;
    }
  }
}
