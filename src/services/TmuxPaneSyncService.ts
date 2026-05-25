// src/services/TmuxPaneSyncService.ts
import type { TmuxSessionManager } from "./TmuxSessionManager";

export interface TmuxPaneInfo {
  tmuxPaneId: string; // e.g. "%0"
  index: number;
  width: number;
  height: number;
  command: string;
  active: boolean;
}

export class TmuxPaneSyncService {
  constructor(private readonly tmux: TmuxSessionManager) {}

  dispose(): void { /* No-op: TmuxSessionManager owns its own lifecycle */ }

  /**
   * List tmux panes for a session, parsing tmux list-panes output
   */
  async listPanes(sessionId: string): Promise<TmuxPaneInfo[]> {
    const output = await this.tmux.executeRawCommand(
      sessionId,
      "list-panes",
      ["-F", "#{pane_id}:#{pane_index}:#{pane_width}:#{pane_height}:#{pane_current_command}:#{pane_active}"]
    );
    if (!output || output.trim() === "") {
      return [];
    }
    return this.parsePaneOutput(output.trim());
  }

  /**
   * Split a tmux pane in the given direction
   * Returns the new tmux pane ID
   */
  async splitPane(
    tmuxPaneId: string,
    direction: "horizontal" | "vertical"
  ): Promise<string> {
    const flag = direction === "horizontal" ? "-h" : "-v";
    const output = await this.tmux.executeRawCommand(
      tmuxPaneId,
      "split-pane",
      [flag, "-P", "-F", "#{pane_id}"]
    );
    const newPaneId = output?.trim();
    if (!newPaneId) {
      throw new Error(`Failed to split tmux pane ${tmuxPaneId}`);
    }
    return newPaneId;
  }

  /**
   * Kill a tmux pane
   */
  async killPane(tmuxPaneId: string): Promise<void> {
    await this.tmux.executeRawCommand(tmuxPaneId, "kill-pane");
  }

  /**
   * Parse tmux list-panes -F output
   * Format: pane_id:pane_index:pane_width:pane_height:pane_current_command:pane_active
   */
  parsePaneOutput(output: string): TmuxPaneInfo[] {
    return output
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const parts = line.split(":");
        return {
          tmuxPaneId: parts[0] ?? "",
          index: parseInt(parts[1] ?? "0", 10),
          width: parseInt(parts[2] ?? "0", 10),
          height: parseInt(parts[3] ?? "0", 10),
          command: parts[4] ?? "",
          active: (parts[5] ?? "0") === "1",
        };
      })
      .filter((pane) => pane.tmuxPaneId !== "");
  }

  /**
   * Map a webview pane direction to tmux direction
   */
  static toTmuxDirection(
    direction: "horizontal" | "vertical"
  ): "horizontal" | "vertical" {
    return direction;
  }
}
