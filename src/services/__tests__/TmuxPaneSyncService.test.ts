// src/services/__tests__/TmuxPaneSyncService.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TmuxPaneSyncService } from "../TmuxPaneSyncService";
import type { TmuxSessionManager } from "../TmuxSessionManager";

function createMockTmux(): { tmux: TmuxSessionManager; executeRawCommand: ReturnType<typeof vi.fn> } {
  const executeRawCommand = vi.fn();
  const tmux = {
    executeRawCommand,
    discoverSessions: vi.fn(),
    discoverSessionDetails: vi.fn(),
  } as unknown as TmuxSessionManager;
  return { tmux, executeRawCommand };
}

describe("TmuxPaneSyncService", () => {
  let service: TmuxPaneSyncService;
  let mockTmux: ReturnType<typeof createMockTmux>;

  beforeEach(() => {
    mockTmux = createMockTmux();
    service = new TmuxPaneSyncService(mockTmux.tmux);
  });

  describe("listPanes", () => {
    it("parses tmux list-panes output", async () => {
      mockTmux.executeRawCommand.mockResolvedValue(
        "%0:0:80:24:bash:1\n%1:1:80:24:vim:0"
      );

      const panes = await service.listPanes("my-session");

      expect(panes).toEqual([
        { tmuxPaneId: "%0", index: 0, width: 80, height: 24, command: "bash", active: true },
        { tmuxPaneId: "%1", index: 1, width: 80, height: 24, command: "vim", active: false },
      ]);
      expect(mockTmux.executeRawCommand).toHaveBeenCalledWith(
        "my-session",
        "list-panes",
        expect.any(Array)
      );
    });

    it("returns empty array for empty output", async () => {
      mockTmux.executeRawCommand.mockResolvedValue("");
      const panes = await service.listPanes("empty");
      expect(panes).toEqual([]);
    });

    it("returns empty array for whitespace output", async () => {
      mockTmux.executeRawCommand.mockResolvedValue("   ");
      const panes = await service.listPanes("ws");
      expect(panes).toEqual([]);
    });
  });

  describe("splitPane", () => {
    it("splits horizontally and returns new pane ID", async () => {
      mockTmux.executeRawCommand.mockResolvedValue("%2\n");
      const newId = await service.splitPane("%0", "horizontal");
      expect(newId).toBe("%2");
      expect(mockTmux.executeRawCommand).toHaveBeenCalledWith(
        "%0",
        "split-pane",
        expect.arrayContaining(["-h"])
      );
    });

    it("splits vertically and returns new pane ID", async () => {
      mockTmux.executeRawCommand.mockResolvedValue("%3");
      const newId = await service.splitPane("%1", "vertical");
      expect(newId).toBe("%3");
      expect(mockTmux.executeRawCommand).toHaveBeenCalledWith(
        "%1",
        "split-pane",
        expect.arrayContaining(["-v"])
      );
    });

    it("throws when split fails", async () => {
      mockTmux.executeRawCommand.mockResolvedValue("");
      await expect(service.splitPane("%0", "horizontal")).rejects.toThrow(
        "Failed to split tmux pane %0"
      );
    });
  });

  describe("killPane", () => {
    it("kills a tmux pane", async () => {
      mockTmux.executeRawCommand.mockResolvedValue("");
      await service.killPane("%1");
      expect(mockTmux.executeRawCommand).toHaveBeenCalledWith(
        "%1",
        "kill-pane"
      );
    });
  });

  describe("parsePaneOutput", () => {
    it("parses single pane line", () => {
      const result = service.parsePaneOutput("%0:0:120:30:zsh:1");
      expect(result).toEqual([
        { tmuxPaneId: "%0", index: 0, width: 120, height: 30, command: "zsh", active: true },
      ]);
    });

    it("handles multiple panes", () => {
      const result = service.parsePaneOutput("%0:0:80:24:bash:1\n%1:1:80:24:node:0");
      expect(result).toHaveLength(2);
    });

    it("filters empty lines", () => {
      const result = service.parsePaneOutput("%0:0:80:24:bash:1\n\n%1:1:80:24:vim:0\n");
      expect(result).toHaveLength(2);
    });

    it("filters lines without pane ID", () => {
      const result = service.parsePaneOutput(":0:80:24:bash:1");
      expect(result).toHaveLength(0);
    });
  });
});
