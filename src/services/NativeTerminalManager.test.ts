import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeTerminalManager } from "./NativeTerminalManager";
import { BackendSessionState } from "./terminalBackends";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

describe("NativeTerminalManager", () => {
  const manager = new NativeTerminalManager();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  const savedState: BackendSessionState = {
    version: 1,
    backend: "native",
    restoreMode: "recreate",
    launchSpec: {
      command: "opencode",
      args: ["--chat"],
      cwd: "/workspace/project",
      name: "test-instance",
    },
    createdAt: 1000,
  };

  it("reports type as 'native'", () => {
    expect(manager.type).toBe("native");
  });

  it("is always available", () => {
    expect(manager.isAvailable()).toBe(true);
  });

  it("creates a launch plan with recreate mode", () => {
    const plan = manager.create("test-instance", {
      command: "opencode",
      args: ["--chat"],
      cwd: "/workspace/project",
    });

    expect(plan.backend).toBe("native");
    expect(plan.restoreMode).toBe("recreate");
  });

  it("creates a plan with the correct launch spec", () => {
    const plan = manager.create("test-instance", {
      command: "opencode",
      args: ["--chat"],
      cwd: "/workspace/project",
    });

    expect(plan.launchSpec.command).toBe("opencode");
    expect(plan.launchSpec.args).toEqual(["--chat"]);
    expect(plan.launchSpec.cwd).toBe("/workspace/project");
    expect(plan.launchSpec.name).toBe("test-instance");
  });

  it("creates a versioned backend session state", () => {
    const plan = manager.create("test-instance", {
      command: "opencode",
    });

    expect(plan.state.version).toBe(1);
    expect(plan.state.backend).toBe("native");
    expect(plan.state.restoreMode).toBe("recreate");
    expect(plan.state.createdAt).toBeTypeOf("number");
    expect(plan.state.launchSpec).toEqual(plan.launchSpec);
  });

  it("works without optional args and cwd", () => {
    const plan = manager.create("minimal", {
      command: "echo hello",
    });

    expect(plan.launchSpec.args).toBeUndefined();
    expect(plan.launchSpec.cwd).toBeUndefined();
    expect(plan.launchSpec.command).toBe("echo hello");
  });

  it("creates a plan with all optional launch fields", () => {
    vi.spyOn(Date, "now").mockReturnValue(3000);

    const plan = manager.create("named-native", {
      command: "claude",
      args: ["--model", "sonnet"],
      cwd: "/workspace/full",
    });

    expect(plan.launchSpec).toEqual({
      command: "claude",
      args: ["--model", "sonnet"],
      cwd: "/workspace/full",
      name: "named-native",
    });
    expect(plan.state).toEqual({
      version: 1,
      backend: "native",
      restoreMode: "recreate",
      launchSpec: plan.launchSpec,
      createdAt: 3000,
    });
  });

  describe("restore", () => {
    it("returns undefined for a completely empty state object", () => {
      const emptyState = {} as BackendSessionState;

      expect(manager.restore(emptyState)).toBeUndefined();
    });

    it("recreates from saved launchSpec with updated createdAt", () => {
      vi.spyOn(Date, "now").mockReturnValue(2000);

      const plan = manager.restore(savedState);

      expect(plan).toBeDefined();
      expect(plan?.backend).toBe("native");
      expect(plan?.restoreMode).toBe("recreate");
      expect(plan?.launchSpec).toEqual(savedState.launchSpec);
      expect(plan?.state.createdAt).toBe(2000);
      expect(plan?.state.launchSpec).toEqual(savedState.launchSpec);
    });

    it("preserves the original command while refreshing timestamps", () => {
      vi.spyOn(Date, "now").mockReturnValue(4000);

      const plan = manager.restore(savedState);

      expect(plan?.launchSpec.command).toBe("opencode");
      expect(plan?.state.launchSpec.command).toBe("opencode");
      expect(plan?.state.createdAt).toBe(4000);
      expect(plan?.state.lastSeenAt).toBe(1000);
    });

    it("clears cwd when directory no longer exists", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const plan = manager.restore(savedState);

      expect(plan?.launchSpec.cwd).toBeUndefined();
      expect(plan?.state.launchSpec.cwd).toBeUndefined();
    });

    it("preserves cwd when directory exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const plan = manager.restore(savedState);

      expect(plan?.launchSpec.cwd).toBe("/workspace/project");
      expect(plan?.state.launchSpec.cwd).toBe("/workspace/project");
    });

    it("returns undefined for unknown version", () => {
      const malformedState = {
        ...savedState,
        version: 99,
      } as BackendSessionState;

      expect(manager.restore(malformedState)).toBeUndefined();
    });

    it("returns undefined for wrong backend", () => {
      const tmuxState: BackendSessionState = {
        ...savedState,
        backend: "tmux",
      };

      expect(manager.restore(tmuxState)).toBeUndefined();
    });

    it("tracks lastSeenAt from original createdAt", () => {
      const plan = manager.restore(savedState);

      expect(plan?.state.lastSeenAt).toBe(savedState.createdAt);
    });
  });
});
