import { describe, expect, it, vi, beforeEach } from "vitest";
import { ZellijPaneSyncService } from "../ZellijPaneSyncService";

// Mock node:child_process
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

import { exec } from "node:child_process";

const mockExec = exec as ReturnType<typeof vi.fn>;

function mockExecResult(stdout: string, error?: Error | null) {
  mockExec.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as (error: Error | null, result: { stdout: string; stderr: string }) => void;
    if (error) {
      callback(error, { stdout: "", stderr: "" });
    } else {
      callback(null, { stdout, stderr: "" });
    }
    return undefined;
  });
}

describe("ZellijPaneSyncService", () => {
  let service: ZellijPaneSyncService;

  beforeEach(() => {
    service = new ZellijPaneSyncService();
    vi.clearAllMocks();
  });

  describe("listPanes", () => {
    it("returns basic pane info when zellij has sessions", async () => {
      mockExecResult("my-session\nother-session\n");
      const panes = await service.listPanes("my-session");
      expect(panes).toHaveLength(1);
      expect(panes[0]).toEqual({
        paneId: "main",
        title: "my-session",
        isFloating: false,
        isFullscreen: false,
      });
    });

    it("returns empty array when no sessions", async () => {
      mockExecResult("");
      const panes = await service.listPanes();
      expect(panes).toEqual([]);
    });

    it("returns empty array when session not found", async () => {
      mockExecResult("other-session\n");
      const panes = await service.listPanes("nonexistent");
      expect(panes).toEqual([]);
    });

    it("returns empty array on exec error", async () => {
      mockExecResult("", new Error("command not found"));
      const panes = await service.listPanes();
      expect(panes).toEqual([]);
    });
  });

  describe("splitPane", () => {
    it("splits horizontally", async () => {
      mockExecResult("ok");
      const paneId = await service.splitPane("horizontal");
      expect(paneId).toMatch(/^zellij-pane-\d+$/);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("new-pane --right"),
        expect.any(Function)
      );
    });

    it("splits vertically", async () => {
      mockExecResult("ok");
      const paneId = await service.splitPane("vertical");
      expect(paneId).toMatch(/^zellij-pane-\d+$/);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("new-pane --down"),
        expect.any(Function)
      );
    });

    it("throws when split fails", async () => {
      mockExecResult("error");
      await expect(service.splitPane("horizontal")).rejects.toThrow(
        "Failed to split zellij pane"
      );
    });
  });

  describe("closePane", () => {
    it("calls close-pane without error", async () => {
      mockExecResult("");
      await service.closePane();
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("close-pane"),
        expect.any(Function)
      );
    });
  });

  describe("isAvailable", () => {
    it("returns true when zellij is found", async () => {
      mockExecResult("/usr/bin/zellij");
      const available = await service.isAvailable();
      expect(available).toBe(true);
    });

    it("returns false when zellij is not found", async () => {
      mockExecResult("", new Error("not found"));
      const available = await service.isAvailable();
      expect(available).toBe(false);
    });
  });
});
