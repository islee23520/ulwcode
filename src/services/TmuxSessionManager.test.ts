import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { TmuxSessionManager, TmuxUnavailableError } from "./TmuxSessionManager";
import { DEFAULT_AI_TOOLS, type AiToolConfig } from "../types";
import type { ILogger } from "./ILogger";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

type MockExecStep = {
  stdout?: string;
  stderr?: string;
  error?: (Error & { code?: number | string }) | null;
};

describe("TmuxSessionManager", () => {
  let manager: TmuxSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TmuxSessionManager();
  });

  function mockExecSequence(steps: MockExecStep[]): void {
    let callIndex = 0;

    vi.mocked(execFile).mockImplementation(((...args: any[]) => {
      const callback = args[args.length - 1] as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const step = steps[callIndex++] ?? { stdout: "", stderr: "" };

      callback(step.error ?? null, step.stdout ?? "", step.stderr ?? "");
      return {} as any;
    }) as any);
  }

  function createLogger(): ILogger {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  it("parses discovered tmux sessions into sidebar entries", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a\t1\t/workspaces/repo-a",
          "repo-b\t0\t/workspaces/repo-b",
        ].join("\n"),
      },
    ]);

    const sessions = await manager.discoverSessions();

    expect(sessions).toEqual([
      {
        id: "repo-a",
        name: "repo-a",
        workspace: "repo-a",
        isActive: true,
      },
      {
        id: "repo-b",
        name: "repo-b",
        workspace: "repo-b",
        isActive: false,
      },
    ]);
  });

  it("ignores malformed session rows without a session name", async () => {
    const originalTrim = String.prototype.trim;
    const trimSpy = vi
      .spyOn(String.prototype, "trim")
      .mockImplementation(function trimForMalformedSessionRow(this: string) {
        const value = this.toString();
        return value === "\t1\t/workspaces/missing-name"
          ? value
          : originalTrim.call(value);
      });
    mockExecSequence([
      {
        stdout: ["\t1\t/workspaces/missing-name", "repo-a\t0\t"].join("\n"),
      },
    ]);

    try {
      await expect(manager.discoverSessions()).resolves.toEqual([
        {
          id: "repo-a",
          name: "repo-a",
          workspace: "repo-a",
          isActive: false,
        },
      ]);
    } finally {
      trimSpy.mockRestore();
    }
  });

  it("reports available when tmux version command succeeds", async () => {
    mockExecSequence([
      {
        stdout: "tmux 3.4",
      },
    ]);

    await expect(manager.isAvailable()).resolves.toBe(true);
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual(["-V"]);
  });

  it("reports unavailable when tmux binary is missing", async () => {
    const missingTmuxError = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });

    mockExecSequence([
      {
        error: missingTmuxError,
      },
    ]);

    await expect(manager.isAvailable()).resolves.toBe(false);
  });

  it("executes supported raw tmux commands with the expected target args", async () => {
    mockExecSequence([
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
    ]);

    await expect(
      manager.executeRawCommand("workspace-a", "rename-session", ["repo-next"]),
    ).resolves.toBe("");
    await expect(
      manager.executeRawCommand("workspace-a", "select-layout", ["tiled"]),
    ).resolves.toBe("");
    await expect(
      manager.executeRawCommand("workspace-a", "respawn-pane"),
    ).resolves.toBe("");
    await expect(
      manager.executeRawCommand("workspace-a", "move-pane", ["-s", "%1"]),
    ).resolves.toBe("");

    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "rename-session",
      "-t",
      "workspace-a",
      "repo-next",
    ]);
    expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
      "select-layout",
      "-t",
      "workspace-a",
      "tiled",
    ]);
    expect(vi.mocked(execFile).mock.calls[2]?.[1]).toEqual([
      "respawn-pane",
      "-t",
      "workspace-a",
      "-k",
    ]);
    expect(vi.mocked(execFile).mock.calls[3]?.[1]).toEqual([
      "move-pane",
      "-t",
      "workspace-a",
      "-s",
      "%1",
    ]);
  });

  it("rejects unsupported raw tmux commands", async () => {
    await expect(
      manager.executeRawCommand("workspace-a", "kill-server"),
    ).rejects.toThrow("Unsupported tmux subcommand: kill-server");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("requires prompt-backed args for rename and layout raw tmux commands", async () => {
    await expect(
      manager.executeRawCommand("workspace-a", "rename-window"),
    ).rejects.toThrow("rename-window requires an argument");
    await expect(
      manager.executeRawCommand("workspace-a", "select-layout", [""]),
    ).rejects.toThrow("select-layout requires an argument");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("reuses an existing tmux session without non-interactive attach", async () => {
    mockExecSequence([
      {
        stdout: "repo-a\t0\t/workspaces/repo-a",
      },
    ]);

    const result = await manager.ensureSession("repo-a", "/workspaces/repo-a");

    expect(result).toEqual({
      action: "attached",
      session: {
        id: "repo-a",
        name: "repo-a",
        workspace: "repo-a",
        isActive: true,
      },
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("prefers exact workspace path match over creating a new session", async () => {
    mockExecSequence([
      {
        stdout: ["legacy-repo-a\t0\t/workspaces/repo-a"].join("\n"),
      },
    ]);

    const result = await manager.ensureSession("repo-a", "/workspaces/repo-a");

    expect(result).toEqual({
      action: "attached",
      session: {
        id: "legacy-repo-a",
        name: "legacy-repo-a",
        workspace: "repo-a",
        isActive: true,
      },
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("prefers the active session when multiple tmux sessions share a workspace", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a-2\t0\t/workspaces/repo-a",
          "repo-a-dev\t1\t/workspaces/repo-a",
        ].join("\n"),
      },
    ]);

    const session = await manager.findSessionForWorkspace("/workspaces/repo-a");

    expect(session).toEqual({
      id: "repo-a-dev",
      name: "repo-a-dev",
      workspace: "repo-a",
      isActive: true,
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("prefers the requested session name when multiple sessions share a workspace", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a-main\t1\t/workspaces/repo-a",
          "repo-a-debug\t0\t/workspaces/repo-a",
        ].join("\n"),
      },
    ]);

    await expect(
      manager.findSessionForWorkspace("/workspaces/repo-a", "repo-a-debug"),
    ).resolves.toEqual({
      id: "repo-a-debug",
      name: "repo-a-debug",
      workspace: "repo-a",
      isActive: false,
    });
  });

  it("keeps workspace matching case-sensitive on linux platforms", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    try {
      mockExecSequence([
        {
          stdout: "Repo-A\t0\t/Workspaces/Repo-A",
        },
      ]);

      await expect(
        manager.findSessionForWorkspace("/workspaces/repo-a", "Repo-A"),
      ).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("avoids wrong-session attachment on name collision by preferring workspace path", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a\t0\t/workspaces/repo-a-archive",
          "repo-a-current\t0\t/workspaces/repo-a",
        ].join("\n"),
      },
    ]);

    const result = await manager.ensureSession("repo-a", "/workspaces/repo-a");

    expect(result).toEqual({
      action: "attached",
      session: {
        id: "repo-a-current",
        name: "repo-a-current",
        workspace: "repo-a",
        isActive: true,
      },
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("creates a collision-safe session when stale metadata prevents workspace match", async () => {
    mockExecSequence([
      {
        stdout: ["repo-a\t0\t", "repo-a-2\t0\t/workspaces/old"].join("\n"),
      },
      {
        stdout: "",
      },
      {
        stdout: "",
      },
    ]);

    const result = await manager.ensureSession("repo-a", "/workspaces/repo-a");

    expect(result).toEqual({
      action: "created",
      session: {
        id: "repo-a-3",
        name: "repo-a-3",
        workspace: "repo-a",
        isActive: true,
      },
    });
    expect(execFile).toHaveBeenCalledTimes(6);
    expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
      "new-session",
      "-d",
      "-s",
      "repo-a-3",
      "-c",
      "/workspaces/repo-a",
    ]);
  });

  it("creates a detached session when no tmux sessions are available", async () => {
    const noServerError = Object.assign(new Error("no server running"), {
      code: 1,
    });

    mockExecSequence([
      {
        error: noServerError,
        stderr: "no server running on /tmp/tmux-1000/default",
      },
      {
        stdout: "",
      },
      {
        stdout: "",
      },
    ]);

    const result = await manager.ensureSession("repo-c", "/workspaces/repo-c");

    expect(result).toEqual({
      action: "created",
      session: {
        id: "repo-c",
        name: "repo-c",
        workspace: "repo-c",
        isActive: true,
      },
    });
    expect(execFile).toHaveBeenCalledTimes(6);
    expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
      "new-session",
      "-d",
      "-s",
      "repo-c",
      "-c",
      "/workspaces/repo-c",
    ]);
  });

  it("kills an existing tmux session", async () => {
    mockExecSequence([
      {
        stdout: "",
      },
    ]);

    await expect(manager.killSession("repo-k")).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "kill-session",
      "-t",
      "repo-k",
    ]);
  });

  it("throws TmuxUnavailableError when killing a session and tmux is missing", async () => {
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([{ error: err }]);

    await expect(manager.killSession("repo-k")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
  });

  it("notifies external pane change listeners and dispose stops future notifications", () => {
    const listener = vi.fn();
    manager.onExternalPaneChange(listener);

    manager.notifyExternalChange("repo-a");
    manager.dispose();
    manager.notifyExternalChange("repo-b");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("repo-a");
  });

  it("attaches to an existing tmux session", async () => {
    mockExecSequence([{ stdout: "" }]);

    await expect(manager.attachSession("repo-a")).resolves.toBeUndefined();
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "attach-session",
      "-t",
      "repo-a",
    ]);
  });

  it("throws TmuxUnavailableError for attachSession when tmux is missing", async () => {
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([{ error: err, stderr: "tmux: not found" }]);

    await expect(manager.attachSession("repo-a")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
  });

  it("creates a tmux session and enables mouse and clipboard support", async () => {
    mockExecSequence([
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
    ]);

    await expect(
      manager.createSession("repo-a", "/workspaces/repo-a"),
    ).resolves.toBeUndefined();
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "new-session",
      "-d",
      "-s",
      "repo-a",
      "-c",
      "/workspaces/repo-a",
    ]);
    expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
      "set-option",
      "-t",
      "repo-a",
      "mouse",
      "on",
    ]);
    expect(vi.mocked(execFile).mock.calls[2]?.[1]).toEqual([
      "set-option",
      "-t",
      "repo-a",
      "set-clipboard",
      "on",
    ]);
    expect(vi.mocked(execFile).mock.calls[3]?.[1]).toEqual([
      "bind-key",
      "-T",
      "copy-mode",
      "MouseDragEnd1Pane",
      "send-keys",
      "-X",
      "copy-selection-and-cancel",
    ]);
    expect(vi.mocked(execFile).mock.calls[4]?.[1]).toEqual([
      "bind-key",
      "-T",
      "copy-mode-vi",
      "MouseDragEnd1Pane",
      "send-keys",
      "-X",
      "copy-selection-and-cancel",
    ]);
  });

  it("throws TmuxUnavailableError for createSession when tmux is missing", async () => {
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([{ error: err, stderr: "tmux: not found" }]);

    await expect(
      manager.createSession("repo-a", "/workspaces/repo-a"),
    ).rejects.toBeInstanceOf(TmuxUnavailableError);
  });

  it("returns tmux buffer contents and falls back to empty string on failure", async () => {
    mockExecSequence([{ stdout: "copied text" }, { error: new Error("boom") }]);

    await expect(manager.showBuffer()).resolves.toBe("copied text");
    await expect(manager.showBuffer()).resolves.toBe("");
  });

  it("sets mouse mode for a session", async () => {
    mockExecSequence([{ stdout: "" }]);

    await expect(manager.setMouseOn("repo-a")).resolves.toBeUndefined();
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "set-option",
      "-t",
      "repo-a",
      "mouse",
      "on",
    ]);
  });

  it("configures mouse, OSC52 clipboard, and mouse copy-mode bindings", async () => {
    mockExecSequence([
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
    ]);

    await expect(
      manager.configureMouseAndClipboard("repo-a"),
    ).resolves.toBeUndefined();
    expect(vi.mocked(execFile).mock.calls.map((call) => call[1])).toEqual([
      ["set-option", "-t", "repo-a", "mouse", "on"],
      ["set-option", "-t", "repo-a", "set-clipboard", "on"],
      [
        "bind-key",
        "-T",
        "copy-mode",
        "MouseDragEnd1Pane",
        "send-keys",
        "-X",
        "copy-selection-and-cancel",
      ],
      [
        "bind-key",
        "-T",
        "copy-mode-vi",
        "MouseDragEnd1Pane",
        "send-keys",
        "-X",
        "copy-selection-and-cancel",
      ],
    ]);
  });

  it("throws TmuxUnavailableError for setMouseOn when tmux is missing", async () => {
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([{ error: err }]);

    await expect(manager.setMouseOn("repo-a")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
  });

  it("warns when registering session hooks fails", async () => {
    const logger = createLogger();
    manager = new TmuxSessionManager(logger);
    mockExecSequence([{ error: new Error("hook failure") }]);

    await expect(
      manager.registerSessionHooks("repo-a", 42),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to register session hooks for "repo-a": hook failure',
      ),
    );
  });

  it("warns with stringified non-Error hook failures", async () => {
    const logger = createLogger();
    const objectError: Error = { name: "ObjectError", message: "plain object" };
    manager = new TmuxSessionManager(logger);
    mockExecSequence([{ error: objectError }]);

    await expect(
      manager.registerSessionHooks("repo-a", 42),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[TmuxSessionManager] Failed to register session hooks for "repo-a": [object Object]',
      ),
    );
  });

  it("warns when unregistering session hooks fails", async () => {
    const logger = createLogger();
    manager = new TmuxSessionManager(logger);
    mockExecSequence([{ error: new Error("hook cleanup failure") }]);

    await expect(
      manager.unregisterSessionHooks("repo-a"),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to unregister session hooks for "repo-a": hook cleanup failure',
      ),
    );
  });

  it("warns with stringified non-Error hook cleanup failures", async () => {
    const logger = createLogger();
    const objectError: Error = { name: "ObjectError", message: "plain object" };
    manager = new TmuxSessionManager(logger);
    mockExecSequence([{ error: objectError }]);

    await expect(manager.unregisterSessionHooks("repo-a")).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[TmuxSessionManager] Failed to unregister session hooks for "repo-a": [object Object]',
      ),
    );
  });

  it("warns when registering session hooks fails because tmux is unavailable", async () => {
    const logger = createLogger();
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    manager = new TmuxSessionManager(logger);
    mockExecSequence([{ error: err }]);

    await expect(
      manager.registerSessionHooks("repo-a", 42),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to register session hooks for "repo-a": tmux is not installed',
      ),
    );
  });

  it("warns when unregistering session hooks fails because tmux is unavailable", async () => {
    const logger = createLogger();
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    manager = new TmuxSessionManager(logger);
    mockExecSequence([{ error: err }]);

    await expect(
      manager.unregisterSessionHooks("repo-a"),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to unregister session hooks for "repo-a": tmux is not installed',
      ),
    );
  });

  it("registers and unregisters all session hooks when commands succeed", async () => {
    mockExecSequence([
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
    ]);

    await manager.registerSessionHooks("repo-a", 99);
    await manager.unregisterSessionHooks("repo-a");

    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
      "set-hook",
      "-g",
      "-t",
      "repo-a",
      "after-split-window",
      'run-shell "kill -USR2 99 2>/dev/null || true"',
    ]);
    expect(vi.mocked(execFile).mock.calls[5]?.[1]).toEqual([
      "set-hook",
      "-u",
      "-g",
      "-t",
      "repo-a",
      "after-select-window",
    ]);
  });

  describe("pane management", () => {
    it("splits pane horizontally and returns new pane ID", async () => {
      mockExecSequence([{ stdout: "%5" }]);
      const result = await manager.splitPane("%0", "h");
      expect(result).toBe("%5");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "split-window",
        "-t",
        "%0",
        "-h",
        "-P",
        "-F",
        "#{pane_id}",
      ]);
    });

    it("splits pane vertically with command", async () => {
      mockExecSequence([{ stdout: "%6" }]);
      const result = await manager.splitPane("%0", "v", { command: "htop" });
      expect(result).toBe("%6");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "split-window",
        "-t",
        "%0",
        "-v",
        "-P",
        "-F",
        "#{pane_id}",
        "htop",
      ]);
    });

    it("splits pane with working directory", async () => {
      mockExecSequence([{ stdout: "%7" }]);
      const result = await manager.splitPane("%0", "h", {
        workingDirectory: "/some/path",
      });
      expect(result).toBe("%7");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "split-window",
        "-t",
        "%0",
        "-h",
        "-P",
        "-F",
        "#{pane_id}",
        "-c",
        "/some/path",
      ]);
    });

    it("splits pane with both working directory and command while logging without a command fallback", async () => {
      const logger = createLogger();
      manager = new TmuxSessionManager(logger);
      mockExecSequence([{ stdout: "%8" }, { stdout: "%9" }]);

      await expect(
        manager.splitPane("%0", "v", {
          workingDirectory: "/workspaces/repo-a",
          command: "npm run dev",
        }),
      ).resolves.toBe("%8");
      await expect(manager.splitPane("%0", "h")).resolves.toBe("%9");

      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "split-window",
        "-t",
        "%0",
        "-v",
        "-P",
        "-F",
        "#{pane_id}",
        "-c",
        "/workspaces/repo-a",
        "npm run dev",
      ]);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('command="none"'),
      );
    });

    it("logs non-Error pane operation failures with fallback values", async () => {
      const logger = createLogger();
      const objectError: Error = { name: "ObjectError", message: "plain object" };
      manager = new TmuxSessionManager(logger);
      mockExecSequence([
        { error: objectError },
        { error: objectError },
        { error: objectError },
        { error: objectError },
      ]);

      await expect(manager.splitPane("%0", "h")).rejects.toBe(objectError);
      await expect(manager.killPane("%0")).rejects.toBe(objectError);
      await expect(manager.selectPane("%0")).rejects.toBe(objectError);
      await expect(manager.sendTextToPane("%0", "ls")).rejects.toBe(objectError);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('error=[object Object]'),
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('windowId="none"'),
      );
    });

    it("logs Error pane operation failures and selectPane success fallback values", async () => {
      const logger = createLogger();
      manager = new TmuxSessionManager(logger);
      mockExecSequence([
        { error: new Error("split failed") },
        { error: new Error("kill failed") },
        { stdout: "" },
        { error: new Error("select failed") },
      ]);

      await expect(manager.splitPane("%0", "h")).rejects.toThrow("split failed");
      await expect(manager.killPane("%0")).rejects.toThrow("kill failed");
      await expect(manager.selectPane("%0")).resolves.toBeUndefined();
      await expect(manager.selectPane("%0")).rejects.toThrow("select failed");

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('SUCCESS paneId="%0" windowId="none"'),
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("error=split failed"),
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("error=kill failed"),
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("error=select failed"),
      );
    });

    it("kills a pane", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.killPane("%0");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "kill-pane",
        "-t",
        "%0",
      ]);
    });

    it("selects a pane", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.selectPane("%0");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "select-pane",
        "-t",
        "%0",
      ]);
    });

    it("selects the target window before selecting a pane in another window", async () => {
      mockExecSequence([{ stdout: "" }, { stdout: "" }]);
      await manager.selectPane("%3", "@2");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "select-window",
        "-t",
        "@2",
      ]);
      expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
        "select-pane",
        "-t",
        "%3",
      ]);
    });

    it("resizes a pane", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.resizePane("%0", "L", 5);
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "resize-pane",
        "-t",
        "%0",
        "-L",
        "5",
      ]);
    });

    it("zooms a pane", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.zoomPane("%0");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "resize-pane",
        "-Z",
        "-t",
        "%0",
      ]);
    });

    it("swaps two panes", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.swapPanes("%0", "%1");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "swap-pane",
        "-s",
        "%0",
        "-t",
        "%1",
      ]);
    });

    it("creates a new window in a session", async () => {
      mockExecSequence([{ stdout: "@1:%3" }]);
      await expect(manager.createWindow("test-session")).resolves.toEqual({
        windowId: "@1",
        paneId: "%3",
      });
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "new-window",
        "-t",
        "test-session",
        "-P",
        "-F",
        "#{window_id}:#{pane_id}",
      ]);
    });

    it("creates a new window with a working directory", async () => {
      mockExecSequence([{ stdout: "@2:%9" }]);

      await expect(
        manager.createWindow("test-session", "/workspaces/repo-a"),
      ).resolves.toEqual({ windowId: "@2", paneId: "%9" });
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "new-window",
        "-t",
        "test-session",
        "-P",
        "-F",
        "#{window_id}:#{pane_id}",
        "-c",
        "/workspaces/repo-a",
      ]);
    });

    it("throws when createWindow output does not include both IDs", async () => {
      mockExecSequence([{ stdout: "@1" }]);

      await expect(manager.createWindow("test-session")).rejects.toThrow(
        "Failed to get window/pane ID from new-window output",
      );
    });

    it("throws TmuxUnavailableError for createWindow when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.createWindow("test-session")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("kills a window", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.killWindow("@0");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "kill-window",
        "-t",
        "@0",
      ]);
    });

    it("rethrows non-tmux killWindow failures", async () => {
      mockExecSequence([{ error: new Error("permission denied") }]);

      await expect(manager.killWindow("@0")).rejects.toThrow(
        "permission denied",
      );
    });

    it("moves between windows and selects a specific window", async () => {
      mockExecSequence([{ stdout: "" }, { stdout: "" }, { stdout: "" }]);

      await manager.nextWindow("test-session");
      await manager.prevWindow("test-session");
      await manager.selectWindow("@4");

      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "next-window",
        "-t",
        "test-session",
      ]);
      expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
        "previous-window",
        "-t",
        "test-session",
      ]);
      expect(vi.mocked(execFile).mock.calls[2]?.[1]).toEqual([
        "select-window",
        "-t",
        "@4",
      ]);
    });

    it("throws TmuxUnavailableError for killWindow when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.killWindow("@0")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("throws TmuxUnavailableError for splitPane when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.splitPane("%0", "h")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("throws TmuxUnavailableError for killPane when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.killPane("%0")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("throws TmuxUnavailableError for selectPane when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.selectPane("%0")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("throws TmuxUnavailableError for resizePane when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.resizePane("%0", "L", 5)).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("throws TmuxUnavailableError for swapPanes when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.swapPanes("%0", "%1")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("lists panes for a session", async () => {
      mockExecSequence([
        {
          stdout:
            "%0\t0\tbash\t1\tbash\t48210\t@0\t/workspaces/repo-a\n%1\t1\tvim\t0\tvim\t48211\t@0\t/workspaces/repo-a/packages/app",
        },
      ]);
      const panes = await manager.listPanes("test-session");
      expect(panes).toEqual([
        {
          paneId: "%0",
          index: 0,
          title: "bash",
          isActive: true,
          currentCommand: "bash",
          windowId: "@0",
          currentPath: "/workspaces/repo-a",
        },
        {
          paneId: "%1",
          index: 1,
          title: "vim",
          isActive: false,
          currentCommand: "vim",
          windowId: "@0",
          currentPath: "/workspaces/repo-a/packages/app",
        },
      ]);
    });

    it("omits optional pane fields when tmux output does not include them", async () => {
      mockExecSequence([
        {
          stdout: "%9\t0\tshell\t1",
        },
      ]);

      await expect(manager.listPanes("test-session")).resolves.toEqual([
        {
          paneId: "%9",
          index: 0,
          title: "shell",
          isActive: true,
        },
      ]);
    });

    it("normalizes empty pane titles when columns are present", async () => {
      mockExecSequence([
        {
          stdout: "%9\t0\t\t1\t\t\t\t",
        },
      ]);

      await expect(manager.listPanes("test-session")).resolves.toEqual([
        {
          paneId: "%9",
          index: 0,
          title: "",
          isActive: true,
        },
      ]);
    });

    it("normalizes parser fallback fields when tmux preserves empty columns", async () => {
      const originalTrim = String.prototype.trim;
      const originalSplit = String.prototype.split;
      const splitImpl: typeof String.prototype.split = function splitWithUndefinedColumns(
        this: string,
        separator:
          | string
          | RegExp
          | { [Symbol.split](string: string, limit?: number): string[] },
        limit?: number,
      ): string[] {
        const value = this.toString();
        if (separator === "\t" && value === "__pane_sparse__") {
          return [null!, "0", "", "1", null!, undefined!, null!, null!];
        }
        if (separator === "\t" && value === "__window_sparse__") {
          return [null!, "2", null!, "0"];
        }
        if (separator === "\t" && value === "__visible_sparse__") {
          return [null!, "1", "2", "3", "4"];
        }
        return originalSplit.call(value, separator, limit);
      };
      const splitSpy = vi
        .spyOn(String.prototype, "split")
        .mockImplementation(splitImpl);
      const trimSpy = vi
        .spyOn(String.prototype, "trim")
        .mockImplementation(function trimSparseMarkers(this: string) {
          return originalTrim.call(this.toString());
        });

      try {
        mockExecSequence([
          { stdout: "__pane_sparse__" },
          { stdout: "__pane_sparse__" },
          { stdout: "__window_sparse__" },
          { stdout: "__visible_sparse__" },
        ]);

        await expect(manager.listPanes("test-session")).resolves.toEqual([
          {
            paneId: "",
            index: 0,
            title: "",
            isActive: true,
            currentCommand: "",
            windowId: "",
            currentPath: "",
          },
        ]);
        await expect(manager.listPaneDtos("test-session")).resolves.toEqual([
          {
            paneId: "",
            index: 0,
            title: "",
            isActive: true,
            currentCommand: "",
            windowId: "",
            currentPath: "",
          },
        ]);
        await expect(manager.listWindows("test-session")).resolves.toEqual([
          { windowId: "", index: 2, name: "", isActive: false },
        ]);
        await expect(manager.listVisiblePaneGeometry("test-session")).resolves.toEqual([
          {
            paneId: "",
            paneLeft: 1,
            paneTop: 2,
            paneWidth: 3,
            paneHeight: 4,
          },
        ]);
      } finally {
        splitSpy.mockRestore();
        trimSpy.mockRestore();
      }
    });

    it("omits pane DTO optionals when pane output has no optional columns", async () => {
      mockExecSequence([{ stdout: "%10\t2\tshell\t0" }]);

      await expect(manager.listPaneDtos("test-session")).resolves.toEqual([
        {
          paneId: "%10",
          index: 2,
          title: "shell",
          isActive: false,
        },
      ]);
    });

    it("lists panes for only the active window when requested", async () => {
      mockExecSequence([
        {
          stdout: "@1\t1\tmain\t1",
        },
        {
          stdout: "%0\t0\tbash\t1\tbash\t48210\t@1\t/workspaces/repo-a",
        },
      ]);
      await manager.listPanes("test-session", { activeWindowOnly: true });
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "list-windows",
        "-t",
        "test-session",
        "-F",
        "#{window_id}\t#{window_index}\t#{window_name}\t#{window_active}",
      ]);
      expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
        "list-panes",
        "-t",
        "test-session:@1",
        "-F",
        "#{pane_id}\t#{pane_index}\t#{pane_title}\t#{pane_active}\t#{pane_current_command}\t#{pane_pid}\t#{window_id}\t#{pane_current_path}",
      ]);
    });

    it("returns no panes when active-window filtering finds no active window", async () => {
      mockExecSequence([
        {
          stdout: ["@1\t0\tmain\t0", "@2\t1\tlogs\t0"].join("\n"),
        },
      ]);

      await expect(
        manager.listPanes("test-session", { activeWindowOnly: true }),
      ).resolves.toEqual([]);
      expect(execFile).toHaveBeenCalledTimes(1);
    });

    it("returns empty array when session has no panes (no server error)", async () => {
      const err = Object.assign(new Error("no server running"), {
        code: 1,
        stderr: "failed to connect to server",
      });
      mockExecSequence([{ error: err }]);
      const panes = await manager.listPanes("test-session");
      expect(panes).toEqual([]);
    });

    it("throws TmuxUnavailableError for listPanes when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.listPanes("test-session")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("lists pane DTOs for a session", async () => {
      mockExecSequence([
        {
          stdout:
            "%0\t0\tbash\t0\tbash\t48210\t@0\t/workspaces/repo-a\n%2\t1\thtop\t1\thtop\t48212\t@0\t/workspaces/repo-a/tools",
        },
      ]);
      const dtos = await manager.listPaneDtos("test-session");
      expect(dtos).toEqual([
        {
          paneId: "%0",
          index: 0,
          title: "bash",
          isActive: false,
          currentCommand: "bash",
          windowId: "@0",
          currentPath: "/workspaces/repo-a",
        },
        {
          paneId: "%2",
          index: 1,
          title: "htop",
          isActive: true,
          currentCommand: "htop",
          windowId: "@0",
          currentPath: "/workspaces/repo-a/tools",
        },
      ]);
    });

    it("parses pane pid from window geometry responses", async () => {
      mockExecSequence([
        {
          stdout:
            "%7\t0\tshell\t1\tnode\t4242\t@3\t/workspaces/repo-a\t0\t0\t120\t30",
        },
      ]);

      const panes = await manager.listWindowPaneGeometry("test-session", "@3");

      expect(panes).toEqual([
        {
          paneId: "%7",
          index: 0,
          title: "shell",
          isActive: true,
          currentCommand: "node",
          panePid: 4242,
          windowId: "@3",
          currentPath: "/workspaces/repo-a",
          paneLeft: 0,
          paneTop: 0,
          paneWidth: 120,
          paneHeight: 30,
        },
      ]);
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "list-panes",
        "-t",
        "test-session:@3",
        "-F",
        "#{pane_id}\t#{pane_index}\t#{pane_title}\t#{pane_active}\t#{pane_current_command}\t#{pane_pid}\t#{window_id}\t#{pane_current_path}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}",
      ]);
    });

    it("omits empty optional geometry fields from pane DTOs", async () => {
      mockExecSequence([
        {
          stdout: "%8\t0\tshell\t0\t\t\t\t\t10\t20\t30\t40",
        },
        { stdout: "" },
      ]);

      await expect(
        manager.listWindowPaneGeometry("test-session", "@4"),
      ).resolves.toEqual([
        {
          paneId: "%8",
          index: 0,
          title: "shell",
          isActive: false,
          paneLeft: 10,
          paneTop: 20,
          paneWidth: 30,
          paneHeight: 40,
        },
      ]);
    });

    it("normalizes sparse geometry rows and non-array tool config", async () => {
      const notTools: readonly AiToolConfig[] = null!;
      mockExecSequence([
        {
          stdout: "%9\t1\t\t0\t\t\t\t\t1\t2\t3\t4",
        },
        { stdout: "" },
      ]);

      await expect(
        manager.listWindowPaneGeometry("test-session", "@4", notTools),
      ).resolves.toEqual([
        {
          paneId: "%9",
          index: 1,
          title: "",
          isActive: false,
          paneLeft: 1,
          paneTop: 2,
          paneWidth: 3,
          paneHeight: 4,
        },
      ]);
    });

    it("normalizes geometry parser fallback fields when columns are nullish", async () => {
      const originalSplit = String.prototype.split;
      const splitImpl: typeof String.prototype.split = function splitGeometryFallbacks(
        this: string,
        separator:
          | string
          | RegExp
          | { [Symbol.split](string: string, limit?: number): string[] },
        limit?: number,
      ): string[] {
        const value = this.toString();
        if (separator === "\t" && value === "__geometry_sparse__") {
          return [
            null!,
            "0",
            null!,
            "0",
            "bash",
            undefined!,
            undefined!,
            undefined!,
            "1",
            "2",
            "3",
            "4",
          ];
        }
        return originalSplit.call(value, separator, limit);
      };
      const splitSpy = vi
        .spyOn(String.prototype, "split")
        .mockImplementation(splitImpl);

      try {
        mockExecSequence([{ stdout: "__geometry_sparse__" }, { stdout: "" }]);

        await expect(
          manager.listWindowPaneGeometry("test-session", "@4"),
        ).resolves.toEqual([
          {
            paneId: "",
            index: 0,
            title: "",
            isActive: false,
            currentCommand: "bash",
            paneLeft: 1,
            paneTop: 2,
            paneWidth: 3,
            paneHeight: 4,
          },
        ]);
      } finally {
        splitSpy.mockRestore();
      }
    });

    it("handles undefined ps stdout while resolving geometry tools", async () => {
      manager = new TmuxSessionManager(undefined, (file, _args, callback) => {
        if (file === "tmux") {
          callback(
            null,
            "%0\t0\tshell\t1\tbash\t100\t@0\t/workspaces/repo-a\t0\t0\t80\t24",
            "",
          );
          return;
        }
        callback(null, undefined!, "");
      });

      await expect(
        manager.listWindowPaneGeometry("test-session", "@0", DEFAULT_AI_TOOLS),
      ).resolves.toEqual([
        expect.objectContaining({ paneId: "%0" }),
      ]);
    });

    it("handles cyclic process trees while resolving descendant tool commands", async () => {
      mockExecSequence([
        {
          stdout:
            "%0\t0\tshell\t1\tbash\t100\t@0\t/workspaces/repo-a\t0\t0\t80\t24",
        },
        {
          stdout: [
            "100 101 bash",
            "101 100 node /usr/local/bin/opencode",
          ].join("\n"),
        },
      ]);

      await expect(
        manager.listWindowPaneGeometry("test-session", "@0", DEFAULT_AI_TOOLS),
      ).resolves.toEqual([
        expect.objectContaining({
          paneId: "%0",
          resolvedTool: "opencode",
        }),
      ]);
    });

    it("ignores invalid ps rows while resolving pane geometry", async () => {
      mockExecSequence([
        {
          stdout:
            "%0\t0\tshell\t1\tbash\t100\t@0\t/workspaces/repo-a\t0\t0\t80\t24",
        },
        {
          stdout: "not a ps row",
        },
      ]);

      await expect(
        manager.listWindowPaneGeometry("test-session", "@0", DEFAULT_AI_TOOLS),
      ).resolves.toEqual([
        expect.objectContaining({ paneId: "%0" }),
      ]);
    });

    it("skips already visited descendant pids defensively", async () => {
      const originalHas = Set.prototype.has;
      let calls = 0;
      const hasSpy = vi
        .spyOn(Set.prototype, "has")
        .mockImplementation(function hasVisitedPid<T>(this: Set<T>, value: T) {
          if (value === 100) {
            calls += 1;
            return calls >= 3;
          }
          return originalHas.call(this, value);
        });
      mockExecSequence([
        {
          stdout:
            "%0\t0\tshell\t1\tbash\t100\t@0\t/workspaces/repo-a\t0\t0\t80\t24",
        },
        {
          stdout: [
            "100 101 bash",
            "101 100 node /usr/local/bin/opencode",
          ].join("\n"),
        },
      ]);

      try {
        await expect(
          manager.listWindowPaneGeometry("test-session", "@0", DEFAULT_AI_TOOLS),
        ).resolves.toEqual([
          expect.objectContaining({ paneId: "%0" }),
        ]);
      } finally {
        hasSpy.mockRestore();
      }
    });

    it("resolves node-based pane tools from descendant process commands", async () => {
      mockExecSequence([
        {
          stdout: [
            "%0\t0\tOC | ULTRAWORK MODE ENABLED!\t1\tnode\t42783\t@0\t/workspaces/repo-a\t0\t0\t100\t20",
            "%1\t1\t⠇ opencode-sidebar-tui\t0\tnode\t13140\t@0\t/workspaces/repo-a\t100\t0\t100\t20",
          ].join("\n"),
        },
        {
          stdout: [
            "42783 41338 -zsh",
            "31251 42783 node /Users/ilseoblee/.bun/bin/opencode -c",
            "13140 41338 -zsh",
            "19171 13140 node /opt/homebrew/bin/omx --madmax --high",
            '19476 19171 codex --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort="high"',
          ].join("\n"),
        },
      ]);

      const panes = await manager.listWindowPaneGeometry(
        "test-session",
        "@0",
        DEFAULT_AI_TOOLS,
      );

      expect(panes).toEqual([
        {
          paneId: "%0",
          index: 0,
          title: "OC | ULTRAWORK MODE ENABLED!",
          isActive: true,
          currentCommand: "node",
          panePid: 42783,
          resolvedTool: "opencode",
          windowId: "@0",
          currentPath: "/workspaces/repo-a",
          paneLeft: 0,
          paneTop: 0,
          paneWidth: 100,
          paneHeight: 20,
        },
        {
          paneId: "%1",
          index: 1,
          title: "⠇ opencode-sidebar-tui",
          isActive: false,
          currentCommand: "node",
          panePid: 13140,
          resolvedTool: "codex",
          windowId: "@0",
          currentPath: "/workspaces/repo-a",
          paneLeft: 100,
          paneTop: 0,
          paneWidth: 100,
          paneHeight: 20,
        },
      ]);
      expect(vi.mocked(execFile).mock.calls[1]?.[0]).toBe("ps");
    });

    it("keeps pane geometry results when process-tree lookup fails", async () => {
      mockExecSequence([
        {
          stdout:
            "%0\t0\tshell\t1\tbash\t4242\t@0\t/workspaces/repo-a\t0\t0\t80\t24",
        },
        { error: new Error("ps failed") },
      ]);

      await expect(
        manager.listWindowPaneGeometry("test-session", "@0"),
      ).resolves.toEqual([
        {
          paneId: "%0",
          index: 0,
          title: "shell",
          isActive: true,
          currentCommand: "bash",
          panePid: 4242,
          windowId: "@0",
          currentPath: "/workspaces/repo-a",
          paneLeft: 0,
          paneTop: 0,
          paneWidth: 80,
          paneHeight: 24,
        },
      ]);
    });

    it("returns empty geometry when listWindowPaneGeometry hits a no-session error", async () => {
      const err = Object.assign(new Error("no sessions"), {
        stderr: "no sessions",
      });
      mockExecSequence([{ error: err }]);

      await expect(
        manager.listWindowPaneGeometry("test-session", "@0"),
      ).resolves.toEqual([]);
    });

    it("returns empty geometry when no-session error has no stderr", async () => {
      mockExecSequence([{ error: new Error("no sessions") }]);

      await expect(
        manager.listWindowPaneGeometry("test-session", "@0"),
      ).resolves.toEqual([]);
    });

    it("lists windows for a session", async () => {
      mockExecSequence([
        {
          stdout: "@0\t0\tmain\t1\n@1\t1\tlogs\t0",
        },
      ]);
      const windows = await manager.listWindows("test-session");
      expect(windows).toEqual([
        { windowId: "@0", index: 0, name: "main", isActive: true },
        { windowId: "@1", index: 1, name: "logs", isActive: false },
      ]);
    });

    it("normalizes sparse window rows after trimming output", async () => {
      mockExecSequence([
        {
          stdout: "\t2\t\t0",
        },
      ]);

      await expect(manager.listWindows("test-session")).resolves.toEqual([
        { windowId: "2", index: 0, name: "0", isActive: false },
      ]);
    });

    it("returns empty array when list-windows fails with no server error", async () => {
      const err = Object.assign(new Error("no server running"), {
        code: 1,
        stderr: "failed to connect to server",
      });
      mockExecSequence([{ error: err }]);
      const windows = await manager.listWindows("test-session");
      expect(windows).toEqual([]);
    });

    it("returns empty windows when no-session error has no stderr", async () => {
      mockExecSequence([{ error: new Error("no sessions") }]);

      await expect(manager.listWindows("test-session")).resolves.toEqual([]);
    });

    it("returns empty windows when tmux callback omits stderr", async () => {
      manager = new TmuxSessionManager(undefined, (_file, _args, callback) => {
        callback(new Error("no sessions"), "", undefined!);
      });

      await expect(manager.listWindows("test-session")).resolves.toEqual([]);
    });

    it("throws TmuxUnavailableError for listWindows when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.listWindows("test-session")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("lists visible pane geometry for a session", async () => {
      mockExecSequence([
        {
          stdout: ["%0\t0\t0\t100\t20", "%1\t100\t0\t100\t20"].join("\n"),
        },
      ]);

      await expect(
        manager.listVisiblePaneGeometry("test-session"),
      ).resolves.toEqual([
        {
          paneId: "%0",
          paneLeft: 0,
          paneTop: 0,
          paneWidth: 100,
          paneHeight: 20,
        },
        {
          paneId: "%1",
          paneLeft: 100,
          paneTop: 0,
          paneWidth: 100,
          paneHeight: 20,
        },
      ]);
    });

    it("parses sparse visible pane geometry rows after trimming output", async () => {
      mockExecSequence([
        {
          stdout: "\t1\t2\t3\t4",
        },
      ]);

      await expect(
        manager.listVisiblePaneGeometry("test-session"),
      ).resolves.toEqual([
        {
          paneId: "1",
          paneLeft: 2,
          paneTop: 3,
          paneWidth: 4,
          paneHeight: Number.NaN,
        },
      ]);
    });

    it("returns empty visible pane geometry on no-session errors", async () => {
      const err = Object.assign(new Error("failed to connect to server"), {
        stderr: "failed to connect to server",
      });
      mockExecSequence([{ error: err }]);

      await expect(
        manager.listVisiblePaneGeometry("test-session"),
      ).resolves.toEqual([]);
    });

    it("throws TmuxUnavailableError for listVisiblePaneGeometry when tmux is missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);

      await expect(
        manager.listVisiblePaneGeometry("test-session"),
      ).rejects.toBeInstanceOf(TmuxUnavailableError);
    });

    it("sends text to a pane", async () => {
      mockExecSequence([{ stdout: "" }]);
      await manager.sendTextToPane("%0", "ls");
      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "send-keys",
        "-t",
        "%0",
        "ls",
        "C-m",
      ]);
    });

    it("sends literal text to a pane without submitting", async () => {
      mockExecSequence([{ stdout: "" }]);

      await manager.sendTextToPane("%3", "npm test", { submit: false });

      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual([
        "send-keys",
        "-t",
        "%3",
        "-l",
        "npm test",
      ]);
    });

    it("rethrows non-tmux sendTextToPane failures", async () => {
      const logger = createLogger();
      manager = new TmuxSessionManager(logger);
      mockExecSequence([{ error: new Error("send failed") }]);

      await expect(manager.sendTextToPane("%0", "ls")).rejects.toThrow(
        "send failed",
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          '[DIAG:sendTextToPane] FAILED paneId="%0" error=send failed',
        ),
      );
    });

    it("throws TmuxUnavailableError for sendTextToPane when tmux missing", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);
      await expect(manager.sendTextToPane("%0", "ls")).rejects.toBeInstanceOf(
        TmuxUnavailableError,
      );
    });

    it("captures pane content and session preview", async () => {
      mockExecSequence([
        { stdout: "pane output" },
        { stdout: "%3\n" },
        { stdout: "preview output" },
      ]);

      await expect(manager.capturePane("%0")).resolves.toBe("pane output");
      await expect(manager.captureSessionPreview("test-session")).resolves.toBe(
        "preview output",
      );
      expect(vi.mocked(execFile).mock.calls[1]?.[1]).toEqual([
        "list-panes",
        "-t",
        "test-session",
        "-f",
        "#{pane_active}",
        "-F",
        "#{pane_id}",
      ]);
    });

    it("returns empty capture results when no active session pane is found or capture fails", async () => {
      mockExecSequence([
        { stdout: "\n" },
        { error: new Error("capture failed") },
      ]);

      await expect(manager.captureSessionPreview("test-session")).resolves.toBe(
        "",
      );
      await expect(manager.capturePane("%0")).resolves.toBe("");
    });

    it("throws TmuxUnavailableError when session preview cannot query panes", async () => {
      const err = Object.assign(new Error("spawn tmux ENOENT"), {
        code: "ENOENT",
      });
      mockExecSequence([{ error: err }]);

      await expect(
        manager.captureSessionPreview("test-session"),
      ).rejects.toBeInstanceOf(TmuxUnavailableError);
    });
  });

  it("surfaces a dedicated error when tmux is missing", async () => {
    const missingTmuxError = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });

    mockExecSequence([
      {
        error: missingTmuxError,
      },
    ]);

    await expect(manager.discoverSessions()).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
  });

  it("builds an empty no-sessions snapshot when tmux has no server", async () => {
    const noServerError = Object.assign(new Error("no server running"), {
      code: 1,
    });

    mockExecSequence([
      {
        error: noServerError,
        stderr: "failed to connect to server",
      },
    ]);

    const snapshot = await manager.createTreeSnapshot();

    expect(snapshot).toEqual({
      type: "treeSnapshot",
      sessions: [],
      activeSessionId: null,
      emptyState: "no-sessions",
    });
  });

  it("builds an empty no-tmux snapshot when tmux is unavailable", async () => {
    const missingTmuxError = Object.assign(new Error("tmux: not found"), {
      code: "ENOENT",
    });

    mockExecSequence([
      {
        error: missingTmuxError,
      },
    ]);

    const snapshot = await manager.createTreeSnapshot();

    expect(snapshot).toEqual({
      type: "treeSnapshot",
      sessions: [],
      activeSessionId: null,
      emptyState: "no-tmux",
    });
  });

  it("uses the discovered active session when creating a populated tree snapshot", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a\t0\t/workspaces/repo-a",
          "repo-b\t1\t/workspaces/repo-b",
        ].join("\n"),
      },
    ]);

    await expect(manager.createTreeSnapshot()).resolves.toEqual({
      type: "treeSnapshot",
      sessions: [
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: false },
        { id: "repo-b", name: "repo-b", workspace: "repo-b", isActive: true },
      ],
      activeSessionId: "repo-b",
      emptyState: undefined,
    });
  });

  it("prefers the explicit active session ID when building a tree snapshot", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-a\t1\t/workspaces/repo-a",
          "repo-b\t0\t/workspaces/repo-b",
        ].join("\n"),
      },
    ]);

    await expect(manager.createTreeSnapshot("repo-b")).resolves.toEqual({
      type: "treeSnapshot",
      sessions: [
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
        { id: "repo-b", name: "repo-b", workspace: "repo-b", isActive: false },
      ],
      activeSessionId: "repo-b",
      emptyState: undefined,
    });
  });

  it("rethrows non-tmux availability and discovery errors", async () => {
    mockExecSequence([
      { error: new Error("version failed") },
      { error: new Error("list failed") },
      { error: new Error("snapshot failed") },
    ]);

    await expect(manager.isAvailable()).rejects.toThrow("version failed");
    await expect(manager.discoverSessions()).rejects.toThrow("list failed");
    await expect(manager.createTreeSnapshot()).rejects.toThrow("snapshot failed");
  });

  it("treats non-Error tmux runner throws as ordinary failures", async () => {
    const stringThrowingManager = new TmuxSessionManager(undefined, () => {
      throw "string failure";
    });

    await expect(stringThrowingManager.isAvailable()).rejects.toBe("string failure");
    await expect(stringThrowingManager.discoverSessions()).rejects.toBe(
      "string failure",
    );
  });

  it("ignores blank session rows and falls back to session names for blank paths", async () => {
    mockExecSequence([
      {
        stdout: ["\t\t", "repo-a\t0\t"].join("\n"),
      },
    ]);

    await expect(manager.discoverSessions()).resolves.toEqual([
      { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: false },
    ]);
  });

  it("picks the lexically first workspace session when no preferred or active session exists", async () => {
    mockExecSequence([
      {
        stdout: [
          "repo-z\t0\t/workspaces/repo-a",
          "repo-a\t0\t/workspaces/repo-a",
        ].join("\n"),
      },
    ]);

    await expect(manager.findSessionForWorkspace("/workspaces/repo-a")).resolves.toEqual({
      id: "repo-a",
      name: "repo-a",
      workspace: "repo-a",
      isActive: false,
    });
  });

  it("uses the requested name as workspace fallback when creating a session for a root path", async () => {
    const noSessions = Object.assign(new Error("no sessions"), {
      stderr: "no sessions",
    });
    mockExecSequence([{ error: noSessions }, { stdout: "" }, { stdout: "" }]);

    await expect(manager.ensureSession("root-session", "/")).resolves.toEqual({
      action: "created",
      session: {
        id: "root-session",
        name: "root-session",
        workspace: "root-session",
        isActive: true,
      },
    });
  });

  it("executes all target-only raw tmux commands and move-window args", async () => {
    mockExecSequence([
      { stdout: "last-window-output" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
      { stdout: "" },
    ]);

    await expect(manager.executeRawCommand("s", "last-window")).resolves.toBe(
      "last-window-output",
    );
    await manager.executeRawCommand("s", "last-pane");
    await manager.executeRawCommand("s", "rotate-window");
    await manager.executeRawCommand("s", "display-panes");
    await manager.executeRawCommand("s", "copy-mode");
    await manager.executeRawCommand("s", "clear-history");
    await manager.executeRawCommand("s", "detach-client");
    await manager.executeRawCommand("s", "choose-tree");
    await manager.executeRawCommand("s", "move-window", ["-s", "@1"]);

    expect(vi.mocked(execFile).mock.calls.map((call) => call[1])).toEqual([
      ["last-window", "-t", "s"],
      ["last-pane", "-t", "s"],
      ["rotate-window", "-t", "s"],
      ["display-panes", "-t", "s"],
      ["copy-mode", "-t", "s"],
      ["clear-history", "-t", "s"],
      ["detach-client", "-t", "s"],
      ["choose-tree", "-t", "s"],
      ["move-window", "-t", "s", "-s", "@1"],
    ]);
  });

  it("maps tmux-not-found stderr failures to unavailable errors for raw commands", async () => {
    const err = Object.assign(new Error("command failed"), {
      stderr: "tmux: not found",
    });
    mockExecSequence([{ error: err, stderr: "tmux: not found" }]);

    await expect(
      manager.executeRawCommand("repo-a", "last-window"),
    ).rejects.toBeInstanceOf(TmuxUnavailableError);
  });

  it("rethrows non-tmux failures for session-level tmux commands", async () => {
    mockExecSequence([
      { error: new Error("attach failed") },
      { error: new Error("create failed") },
      { error: new Error("raw failed") },
      { error: new Error("mouse failed") },
      { error: new Error("kill failed") },
    ]);

    await expect(manager.attachSession("repo-a")).rejects.toThrow("attach failed");
    await expect(manager.createSession("repo-a", "/repo-a")).rejects.toThrow(
      "create failed",
    );
    await expect(manager.executeRawCommand("repo-a", "last-pane")).rejects.toThrow(
      "raw failed",
    );
    await expect(manager.setMouseOn("repo-a")).rejects.toThrow("mouse failed");
    await expect(manager.killSession("repo-a")).rejects.toThrow("kill failed");
  });

  it("uses a noop hook command on Windows", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    try {
      mockExecSequence([{ stdout: "" }, { stdout: "" }, { stdout: "" }]);

      await manager.registerSessionHooks("repo-a", 123);

      expect(vi.mocked(execFile).mock.calls[0]?.[1]).toContain(
        'run-shell "echo noop"',
      );
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("rethrows non-tmux pane operation failures", async () => {
    mockExecSequence([
      { error: new Error("next failed") },
      { error: new Error("prev failed") },
      { error: new Error("select-window failed") },
      { error: new Error("select-pane failed") },
      { error: new Error("resize failed") },
      { error: new Error("zoom failed") },
      { error: new Error("swap failed") },
    ]);

    await expect(manager.nextWindow("s")).rejects.toThrow("next failed");
    await expect(manager.prevWindow("s")).rejects.toThrow("prev failed");
    await expect(manager.selectWindow("@1")).rejects.toThrow(
      "select-window failed",
    );
    await expect(manager.selectPane("%1")).rejects.toThrow("select-pane failed");
    await expect(manager.resizePane("%1", "R", 2)).rejects.toThrow(
      "resize failed",
    );
    await expect(manager.zoomPane("%1")).rejects.toThrow("zoom failed");
    await expect(manager.swapPanes("%1", "%2")).rejects.toThrow("swap failed");
  });

  it("rethrows non-tmux splitPane failures", async () => {
    mockExecSequence([{ error: new Error("split failed") }]);

    await expect(manager.splitPane("%1", "h")).rejects.toThrow("split failed");
  });

  it("rethrows non-tmux killPane failures", async () => {
    mockExecSequence([{ error: new Error("kill pane failed") }]);

    await expect(manager.killPane("%1")).rejects.toThrow("kill pane failed");
  });

  it("maps missing tmux errors for window navigation and zoom operations", async () => {
    const missing = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([
      { error: missing },
      { error: missing },
      { error: missing },
      { error: missing },
    ]);

    await expect(manager.nextWindow("s")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
    await expect(manager.prevWindow("s")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
    await expect(manager.selectWindow("@1")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
    await expect(manager.zoomPane("%1")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
  });

  it("parses sparse tmux window, pane, and geometry rows with fallback fields", async () => {
    mockExecSequence([
      { stdout: "@9\t3" },
      { stdout: "%9" },
      { stdout: "%8" },
    ]);

    await expect(manager.listWindows("s")).resolves.toEqual([
      { windowId: "@9", index: 3, name: "", isActive: false },
    ]);
    await expect(manager.listPanes("s")).resolves.toEqual([
      { paneId: "%9", index: Number.NaN, title: "", isActive: false },
    ]);
    await expect(manager.listVisiblePaneGeometry("s")).resolves.toEqual([
      {
        paneId: "%8",
        paneLeft: Number.NaN,
        paneTop: Number.NaN,
        paneWidth: Number.NaN,
        paneHeight: Number.NaN,
      },
    ]);
  });

  it("rethrows non-session list failures", async () => {
    mockExecSequence([
      { error: new Error("windows failed") },
      { error: new Error("panes failed") },
      { error: new Error("geometry failed") },
      { error: new Error("window geometry failed") },
    ]);

    await expect(manager.listWindows("s")).rejects.toThrow("windows failed");
    await expect(manager.listPanes("s")).rejects.toThrow("panes failed");
    await expect(manager.listVisiblePaneGeometry("s")).rejects.toThrow(
      "geometry failed",
    );
    await expect(manager.listWindowPaneGeometry("s", "@1")).rejects.toThrow(
      "window geometry failed",
    );
  });

  it("maps missing tmux errors from window pane geometry", async () => {
    const err = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([{ error: err }]);

    await expect(manager.listWindowPaneGeometry("s", "@1")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
  });

  it("detects pane tools directly from current commands and avoids repeated process traversal", async () => {
    mockExecSequence([
      {
        stdout: [
          "%1\t0\tshell\t1\topencode\t10\t@1\t/work\t0\t0\t80\t20",
          "%2\t1\tshell\t0\tnode\t20\t@1\t/work\t80\t0\t80\t20",
        ].join("\n"),
      },
      {
        stdout: [
          "10 1 shell",
          "20 1 shell",
          "30 20 codex --ask-for-approval never",
          "40 30 opencode nested",
          "30 20 duplicate-cycle",
        ].join("\n"),
      },
    ]);

    const panes = await manager.listWindowPaneGeometry("s", "@1", DEFAULT_AI_TOOLS);

    expect(panes[0]?.resolvedTool).toBe("opencode");
    expect(panes[1]?.resolvedTool).toBe("opencode");
  });

  it("returns focused tmux context, undefined incomplete focus, and undefined on focus errors", async () => {
    mockExecSequence([
      { stdout: "$1\t@2\t%3" },
      { stdout: "$1\t@2" },
      { error: new Error("focus failed") },
    ]);

    await expect(manager.getActiveFocus()).resolves.toEqual({
      sessionId: "$1",
      windowId: "@2",
      paneId: "%3",
    });
    await expect(manager.getActiveFocus()).resolves.toBeUndefined();
    await expect(manager.getActiveFocus()).resolves.toBeUndefined();
  });

  it("maps missing tmux errors while capturing panes and session previews", async () => {
    const missing = Object.assign(new Error("spawn tmux ENOENT"), {
      code: "ENOENT",
    });
    mockExecSequence([{ error: missing }, { error: missing }]);

    await expect(manager.capturePane("%1")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
    await expect(manager.captureSessionPreview("s")).rejects.toBeInstanceOf(
      TmuxUnavailableError,
    );
  });

  it("returns an empty session preview for non-tmux active-pane lookup failures", async () => {
    mockExecSequence([{ error: new Error("preview failed") }]);

    await expect(manager.captureSessionPreview("s")).resolves.toBe("");
  });
});
