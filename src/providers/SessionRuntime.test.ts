import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as os from "node:os";
import type * as vscodeApi from "vscode";
import type * as vscodeTypes from "../test/mocks/vscode";
import { SessionRuntime } from "./SessionRuntime";
import { TerminalManager } from "../terminals/TerminalManager";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { PortManager } from "../services/PortManager";
import { ContextSharingService } from "../services/ContextSharingService";
import { OutputChannelService } from "../services/OutputChannelService";
import { InstanceStore } from "../services/InstanceStore";
import {
  TmuxSessionManager,
  TmuxUnavailableError,
} from "../services/TmuxSessionManager";
import { AiToolOperatorRegistry } from "../services/aiTools/AiToolOperatorRegistry";
import { ZellijSessionManager } from "../services/ZellijSessionManager";
import { NativeTerminalManager } from "../services/NativeTerminalManager";
import {
  StaticTerminalBackend,
  TerminalBackendRegistry,
} from "../services/terminalBackends";
import type { AiToolConfig, TerminalBackendType } from "../types";

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

vi.mock("node-pty", async () => {
  const actual = await vi.importActual("../test/mocks/node-pty");
  return actual;
});

describe("SessionRuntime - Workspace Session Resolution", () => {
  const flushAsyncWork = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  let sessionRuntime: SessionRuntime;
  let mockTmuxSessionManager: TmuxSessionManager;
  let mockZellijSessionManager: ZellijSessionManager;
  let mockNativeTerminalManager: NativeTerminalManager;
  let backendRegistry: TerminalBackendRegistry;
  let mockTerminalManager: TerminalManager;
  let mockPortManager: PortManager;
  let mockAiToolRegistry: AiToolOperatorRegistry;
  let mockContextSharingService: ContextSharingService;
  let instanceStore: InstanceStore;
  let mockLogger: OutputChannelService;
  let postMessageMock: ReturnType<typeof vi.fn<(message: unknown) => void>>;
  let onActiveInstanceChangedMock: ReturnType<
    typeof vi.fn<(instanceId: string) => void>
  >;
  let requestStartOpenCodeMock: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let exitHandler: ((id: string) => void) | undefined;
  let mockCallbacks: {
    postMessage: (message: unknown) => void;
    onActiveInstanceChanged: (instanceId: string) => void;
    requestStartOpenCode: () => Promise<void>;
  };

  const setConfiguration = (values: Record<string, unknown> = {}): void => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(<T>(key: string, defaultValue?: T): T => {
        return key in values ? (values[key] as T) : (defaultValue as T);
      }),
      inspect: vi.fn(() => undefined),
      update: vi.fn(async () => undefined),
    } as ReturnType<typeof vscode.workspace.getConfiguration>);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    OutputChannelService.resetInstance();
    setConfiguration();

    vscode.workspace.workspaceFolders = [
      {
        uri: { fsPath: "/workspace/project-a" },
        name: "project-a",
        index: 0,
      },
    ];

    mockTmuxSessionManager = {
      listPanes: vi.fn(),
      listWindows: vi.fn(),
      discoverSessions: vi.fn(),
      createWindow: vi.fn(),
      createGroupedSession: vi.fn(),
      createSession: vi.fn(),
      selectWindow: vi.fn(),
      splitPane: vi.fn(),
      ensureSession: vi.fn(),
      nextWindow: vi.fn(),
      prevWindow: vi.fn(),
      zoomPane: vi.fn(),
      killPane: vi.fn(),
      killWindow: vi.fn(),
      killSession: vi.fn(),
      registerSessionHooks: vi.fn(),
      setMouseOn: vi.fn(),
      configureMouseAndClipboard: vi.fn(),
      showBuffer: vi.fn(),
      onExternalPaneChange: vi.fn(),
      selectPane: vi.fn(),
      sendTextToPane: vi.fn(),
      listVisiblePaneGeometry: vi.fn(),
      listSessions: vi.fn(),
      findSessionForWorkspace: vi.fn(),
      getSessionInfo: vi.fn(),
    } as unknown as TmuxSessionManager;

    mockZellijSessionManager = {
      discoverSessions: vi.fn(),
      ensureSession: vi.fn(),
      createSession: vi.fn(),
      killSession: vi.fn(),
      switchSession: vi.fn(),
      zoomPane: vi.fn(),
      sendTextToPane: vi.fn(),
      listPanes: vi.fn(),
      listTabs: vi.fn(),
      setActiveSessionName: vi.fn(),
      getAttachCommand: vi.fn(
        (sessionName: string) => `zellij attach '${sessionName}'`,
      ),
      isAvailable: vi.fn(async () => true),
    } as unknown as ZellijSessionManager;

    mockNativeTerminalManager = {
      type: "native" as const,
      isAvailable: vi.fn(() => true),
      create: vi.fn((instanceId, options) => ({
        backend: "native",
        restoreMode: "recreate" as const,
        launchSpec: {
          command: options.command,
          args: options.args,
          cwd: options.cwd,
          name: instanceId,
        },
        state: {
          version: 1 as const,
          backend: "native",
          restoreMode: "recreate" as const,
          launchSpec: {
            command: options.command,
            args: options.args,
            cwd: options.cwd,
            name: instanceId,
          },
          createdAt: Date.now(),
        },
      })),
    } as unknown as NativeTerminalManager;

    backendRegistry = new TerminalBackendRegistry([
      new StaticTerminalBackend("native", "Native", true),
      new StaticTerminalBackend("tmux", "Tmux", true),
      new StaticTerminalBackend("zellij", "Zellij", true),
    ]);

    mockTerminalManager = {
      getByInstance: vi.fn(),
      getTerminal: vi.fn(),
      killByInstance: vi.fn(),
      killTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      createTerminal: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn((callback: (id: string) => void) => {
        exitHandler = callback;
        return { dispose: vi.fn() };
      }),
    } as unknown as TerminalManager;

    mockPortManager = {
      releaseTerminalPorts: vi.fn(),
      assignPortToTerminal: vi.fn(),
    } as unknown as PortManager;

    mockAiToolRegistry = {
      getForConfig: vi.fn(),
      getByToolName: vi.fn(),
      matchesName: vi.fn((tool, toolName) => tool.name === toolName),
    } as unknown as AiToolOperatorRegistry;

    mockContextSharingService = {
      getCurrentContext: vi.fn(),
    } as unknown as ContextSharingService;

    instanceStore = new InstanceStore();

    mockLogger = OutputChannelService.getInstance();
    vi.spyOn(mockLogger, "warn");
    vi.spyOn(mockLogger, "error");
    vi.spyOn(mockLogger, "info");

    postMessageMock = vi.fn();
    onActiveInstanceChangedMock = vi.fn();
    requestStartOpenCodeMock = vi.fn().mockResolvedValue(undefined);
    mockCallbacks = {
      postMessage: (message) => {
        postMessageMock(message);
      },
      onActiveInstanceChanged: (instanceId) => {
        onActiveInstanceChangedMock(instanceId);
      },
      requestStartOpenCode: () => requestStartOpenCodeMock(),
    };

    sessionRuntime = new SessionRuntime(
      mockTerminalManager,
      {} as OutputCaptureManager,
      undefined as unknown as OpenCodeApiClient,
      mockPortManager,
      mockTmuxSessionManager,
      mockZellijSessionManager,
      backendRegistry,
      instanceStore,
      mockLogger,
      mockContextSharingService,
      mockAiToolRegistry,
      mockCallbacks,
      mockNativeTerminalManager,
    );

    exitHandler = undefined;
  });

  afterEach(() => {
    sessionRuntime.dispose();
    OutputChannelService.resetInstance();
  });

  const upsertInstance = (options?: {
    id?: string;
    workspaceUri?: string;
    tmuxSessionId?: string;
    zellijSessionId?: string;
    selectedAiTool?: string;
  }) => {
    const id = options?.id ?? "default";
    instanceStore.upsert({
      config: {
        id,
        workspaceUri: options?.workspaceUri,
        selectedAiTool: options?.selectedAiTool,
      },
      runtime: {
        terminalKey: id,
        tmuxSessionId: options?.tmuxSessionId,
        zellijSessionId: options?.zellijSessionId,
      },
      state: "connected",
    });
    return id;
  };

  const setActiveBackend = (backend: TerminalBackendType): void => {
    (
      sessionRuntime as unknown as { activeBackend: TerminalBackendType }
    ).activeBackend = backend;
  };

  const registerDefaultSession = (overrides?: {
    instanceId?: string;
    terminalKey?: string;
    tmuxSessionId?: string;
    zellijSessionId?: string;
    backend?: TerminalBackendType;
  }): void => {
    (
      sessionRuntime as unknown as {
        registerSession: (session: {
          paneId: string;
          instanceId: string;
          terminalKey: string;
          tmuxSessionId?: string;
          zellijSessionId?: string;
          backend: TerminalBackendType;
        }) => void;
      }
    ).registerSession({
      paneId: "default",
      instanceId: overrides?.instanceId ?? "default",
      terminalKey: overrides?.terminalKey ?? "default",
      tmuxSessionId: overrides?.tmuxSessionId,
      zellijSessionId: overrides?.zellijSessionId,
      backend: overrides?.backend ?? "native",
    });
  };

  describe("checkPaneChanges", () => {
    it("falls back to discovered sessions and posts active session metadata", async () => {
      setActiveBackend("tmux");
      vi.mocked(mockTmuxSessionManager.discoverSessions).mockResolvedValue([
        { id: "fallback-session", isActive: true },
      ] as unknown as Awaited<
        ReturnType<TmuxSessionManager["discoverSessions"]>
      >);
      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValue([
        { paneId: "%1", isActive: true, currentCommand: "/bin/bash" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listPanes"]>>);
      vi.mocked(mockTmuxSessionManager.listWindows).mockResolvedValue([
        { windowId: "@1", isActive: true, index: 1, name: "main" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listWindows"]>>);

      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();

      expect(postMessageMock).toHaveBeenCalledWith({
        type: "activeSession",
        sessionName: "fallback-session",
        sessionId: "fallback-session",
        windowIndex: 1,
        windowName: "main",
        canKillPane: false,
      });

      postMessageMock.mockClear();
      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();
      expect(postMessageMock).not.toHaveBeenCalled();
    });

    it("posts updates when window focus changes", async () => {
      setActiveBackend("tmux");
      upsertInstance({ tmuxSessionId: "workspace-session" });
      (
        sessionRuntime as unknown as { knownActiveWindowId?: string }
      ).knownActiveWindowId = "@1";

      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValue([
        { paneId: "%1", isActive: false, currentCommand: "zsh" },
        { paneId: "%2", isActive: true, currentCommand: "claude" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listPanes"]>>);
      vi.mocked(mockTmuxSessionManager.listWindows).mockResolvedValue([
        { windowId: "@2", isActive: true, index: 2, name: "agent" },
        { windowId: "@1", isActive: false, index: 1, name: "main" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listWindows"]>>);

      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();

      expect(postMessageMock).toHaveBeenCalledWith({
        type: "activeSession",
        sessionName: "workspace-session",
        sessionId: "workspace-session",
        windowIndex: 2,
        windowName: "agent",
        canKillPane: true,
      });
    });

    it("silently ignores tmux polling errors", async () => {
      setActiveBackend("tmux");
      upsertInstance({ tmuxSessionId: "workspace-session" });
      vi.mocked(mockTmuxSessionManager.listPanes).mockRejectedValue(
        new Error("tmux unavailable"),
      );

      await expect(
        (
          sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
        ).checkPaneChanges(),
      ).resolves.toBeUndefined();
      expect(postMessageMock).not.toHaveBeenCalled();
    });

    it("routes zellij polling through panes and tabs", async () => {
      setActiveBackend("zellij");
      upsertInstance({ zellijSessionId: "zellij-session" });

      vi.mocked(mockZellijSessionManager.listPanes).mockResolvedValue([
        {
          id: "terminal_1",
          title: "shell",
          isFocused: true,
          isFloating: false,
        },
        {
          id: "terminal_2",
          title: "agent",
          isFocused: false,
          isFloating: false,
        },
      ] as Awaited<ReturnType<ZellijSessionManager["listPanes"]>>);
      vi.mocked(mockZellijSessionManager.listTabs).mockResolvedValue([
        { index: 1, name: "main", isActive: true },
      ] as Awaited<ReturnType<ZellijSessionManager["listTabs"]>>);

      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();

      expect(mockZellijSessionManager.listPanes).toHaveBeenCalled();
      expect(mockZellijSessionManager.listTabs).toHaveBeenCalled();
      expect(mockTmuxSessionManager.listPanes).not.toHaveBeenCalled();
      expect(postMessageMock).toHaveBeenCalledWith({
        type: "activeSession",
        sessionName: "zellij-session",
        sessionId: "zellij-session",
        windowIndex: 1,
        windowName: "main",
        canKillPane: true,
      });
    });

    it("starts zellij change monitoring with polling only", async () => {
      setActiveBackend("zellij");
      vi.mocked(mockZellijSessionManager.listPanes).mockResolvedValue([
        {
          id: "terminal_1",
          title: "shell",
          isFocused: true,
          isFloating: false,
        },
      ] as Awaited<ReturnType<ZellijSessionManager["listPanes"]>>);

      await (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring("zellij-session");

      expect(mockZellijSessionManager.listPanes).toHaveBeenCalled();
      expect(mockTmuxSessionManager.listPanes).not.toHaveBeenCalled();
      expect(
        mockTmuxSessionManager.onExternalPaneChange,
      ).not.toHaveBeenCalled();
      expect(
        (sessionRuntime as unknown as { paneMonitorInterval?: unknown })
          .paneMonitorInterval,
      ).toBeDefined();
    });
  });

  describe("terminal exit restoration", () => {
    it("switches to a replacement workspace tmux session when the attached tmux process exits", async () => {
      upsertInstance({
        tmuxSessionId: "workspace-session",
        workspaceUri: "file:///workspace/project-a",
      });
      (sessionRuntime as unknown as { isStarted: boolean }).isStarted = true;
      (
        sessionRuntime as unknown as { selectedTmuxSessionId?: string }
      ).selectedTmuxSessionId = "workspace-session";

      vi.mocked(
        mockTmuxSessionManager.findSessionForWorkspace,
      ).mockResolvedValue({
        id: "replacement-session",
      } as Awaited<ReturnType<TmuxSessionManager["findSessionForWorkspace"]>>);

      const switchSpy = vi
        .spyOn(sessionRuntime, "switchToTmuxSessionWithTool")
        .mockResolvedValue();
      registerDefaultSession({
        tmuxSessionId: "workspace-session",
        backend: "tmux",
      });

      sessionRuntime.reconnectListeners();
      expect(exitHandler).toBeDefined();

      exitHandler?.("default");

      await flushAsyncWork();

      expect(switchSpy).toHaveBeenCalledWith("replacement-session");

      expect(
        instanceStore.get("default")?.runtime.tmuxSessionId,
      ).toBeUndefined();
      expect(mockPortManager.releaseTerminalPorts).toHaveBeenCalledWith(
        "default",
      );
      expect(postMessageMock).not.toHaveBeenCalledWith({
        type: "terminalExited",
      });
    });

    it("falls back to native shell when the attached tmux process exits with no replacement", async () => {
      upsertInstance({
        tmuxSessionId: "workspace-session",
        workspaceUri: "file:///workspace/project-a",
      });
      (sessionRuntime as unknown as { isStarted: boolean }).isStarted = true;

      const nativeShellSpy = vi
        .spyOn(sessionRuntime, "switchToNativeShell")
        .mockResolvedValue();
      registerDefaultSession({
        tmuxSessionId: "workspace-session",
        backend: "tmux",
      });

      sessionRuntime.reconnectListeners();
      expect(exitHandler).toBeDefined();

      exitHandler?.("default");

      await flushAsyncWork();

      expect(nativeShellSpy).toHaveBeenCalled();

      expect(
        instanceStore.get("default")?.runtime.tmuxSessionId,
      ).toBeUndefined();
      expect(mockPortManager.releaseTerminalPorts).toHaveBeenCalledWith(
        "default",
      );
      expect(postMessageMock).not.toHaveBeenCalledWith({
        type: "terminalExited",
      });
    });
  });

  describe("session and shell switching", () => {
    it("switches to a tmux session with a preferred tool and persists the selection", async () => {
      upsertInstance({
        id: "workspace-instance",
        workspaceUri: "file:///workspace/project-a",
      });

      const switchToInstanceSpy = vi
        .spyOn(sessionRuntime, "switchToInstance")
        .mockResolvedValue();
      const startMonitoringSpy = vi
        .spyOn(
          sessionRuntime as unknown as {
            startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
          },
          "startExternalChangeMonitoring",
        )
        .mockResolvedValue();

      await sessionRuntime.switchToTmuxSessionWithTool(
        "project-a",
        "preferred-tool",
      );

      expect(mockTmuxSessionManager.registerSessionHooks).toHaveBeenCalledWith(
        "project-a",
        process.pid,
      );
      expect(startMonitoringSpy).toHaveBeenCalledWith("project-a");
      expect(switchToInstanceSpy).toHaveBeenCalledWith("workspace-instance", {
        forceRestart: true,
        preferredToolName: "preferred-tool",
      });
      expect(sessionRuntime.getSelectedTmuxSessionId()).toBe("project-a");
      expect(
        instanceStore.get("workspace-instance")?.config.selectedAiTool,
      ).toBe("preferred-tool");
      expect(postMessageMock).toHaveBeenCalledWith({
        type: "activeSession",
        sessionName: "project-a",
        sessionId: "project-a",
        backend: "tmux",
      });
    });

    it("switches back to native shell and clears the stored tmux session", async () => {
      upsertInstance({
        tmuxSessionId: "workspace-session",
        workspaceUri: "file:///workspace/project-a",
      });

      const switchToInstanceSpy = vi
        .spyOn(sessionRuntime, "switchToInstance")
        .mockResolvedValue();

      await sessionRuntime.switchToNativeShell();

      expect(sessionRuntime.getSelectedTmuxSessionId()).toBeUndefined();
      expect(
        instanceStore.get("default")?.runtime.tmuxSessionId,
      ).toBeUndefined();
      expect(switchToInstanceSpy).toHaveBeenCalledWith("default", {
        forceRestart: true,
      });
      expect(postMessageMock).toHaveBeenCalledWith({
        type: "activeSession",
        backend: "native",
      });
    });
  });

  describe("resolveInstanceIdFromSessionId", () => {
    it("prefers direct instance IDs, then tmux mappings, then workspace name mappings", () => {
      upsertInstance({
        id: "direct-instance",
        workspaceUri: "file:///workspace/direct",
      });
      upsertInstance({ id: "tmux-instance", tmuxSessionId: "tmux-session" });
      upsertInstance({
        id: "workspace-instance",
        workspaceUri: "file:///workspace/project-a",
      });

      expect(
        sessionRuntime.resolveInstanceIdFromSessionId("direct-instance"),
      ).toBe("direct-instance");
      expect(
        sessionRuntime.resolveInstanceIdFromSessionId("tmux-session"),
      ).toBe("tmux-instance");
      upsertInstance({
        id: "zellij-instance",
        zellijSessionId: "zellij-session",
      });
      expect(
        sessionRuntime.resolveInstanceIdFromSessionId("zellij-session"),
      ).toBe("zellij-instance");
      expect(sessionRuntime.resolveInstanceIdFromSessionId("project-a")).toBe(
        "workspace-instance",
      );
    });

    it("falls back to the active instance when no mapping exists or no store is available", () => {
      upsertInstance({
        id: "active-instance",
        workspaceUri: "not-a-valid-uri",
      });
      instanceStore.setActive("active-instance");
      (
        sessionRuntime as unknown as { activeInstanceId: string }
      ).activeInstanceId = "active-instance";

      expect(
        sessionRuntime.resolveInstanceIdFromSessionId("missing-session"),
      ).toBe("active-instance");

      const runtimeWithoutStore = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        mockTmuxSessionManager,
        mockZellijSessionManager,
        backendRegistry,
        undefined,
        mockLogger,
        {} as ContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );

      expect(
        runtimeWithoutStore.resolveInstanceIdFromSessionId("anything"),
      ).toBe("opencode-main");

      runtimeWithoutStore.dispose();
    });
  });

  describe("instance switching and startup", () => {
    it("switches to a zellij backend session", async () => {
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockZellijSessionManager.ensureSession).mockResolvedValue({
        action: "created",
        session: {
          id: "project-a",
          name: "project-a",
          workspace: "project-a",
          isActive: true,
        },
      });

      await sessionRuntime.selectTerminalBackend("zellij");

      expect(mockZellijSessionManager.ensureSession).toHaveBeenCalledWith(
        "project-a",
        "/workspace/project-a",
      );
      expect(requestStartOpenCodeMock).toHaveBeenCalled();
      expect(sessionRuntime.getActiveBackend()).toBe("zellij");
    });

    it("keeps explicit zellij selection when JSON config defaults to tmux", async () => {
      setConfiguration({
        terminalBackend: "tmux" satisfies TerminalBackendType,
      });
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockZellijSessionManager.ensureSession).mockResolvedValue({
        action: "created",
        session: {
          id: "project-a",
          name: "project-a",
          workspace: "project-a",
          isActive: true,
        },
      });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{ name: string }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool" });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.selectTerminalBackend("zellij");
      requestStartOpenCodeMock.mockClear();

      await sessionRuntime.startOpenCode();

      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "zellij attach 'project-a'",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
      expect(instanceStore.get("default")?.runtime.terminalBackend).toBe(
        "zellij",
      );
      expect(instanceStore.get("default")?.runtime.zellijSessionId).toBe(
        "project-a",
      );
    });

    it("keeps explicit tmux session selection when JSON config defaults to zellij", async () => {
      setConfiguration({
        terminalBackend: "zellij" satisfies TerminalBackendType,
      });
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{ name: string }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool" });
      vi.spyOn(
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        },
        "startExternalChangeMonitoring",
      ).mockResolvedValue();
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.switchToTmuxSession("manual-tmux");
      requestStartOpenCodeMock.mockClear();

      await sessionRuntime.startOpenCode();

      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "tmux attach-session -t manual-tmux \\; set-option -u status off",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
      expect(instanceStore.get("default")?.runtime.terminalBackend).toBe(
        "tmux",
      );
      expect(instanceStore.get("default")?.runtime.tmuxSessionId).toBe(
        "manual-tmux",
      );
    });

    it("launches the startup tool inside newly created tmux workspace sessions", async () => {
      setConfiguration({
        terminalBackend: "tmux" satisfies TerminalBackendType,
        defaultAiTool: "opencode",
        aiTools: [{ name: "opencode", label: "OpenCode", path: "", args: [] }],
      });
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "created" as const,
        session: {
          id: "project-a",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValue([
        { paneId: "%1", isActive: true },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listPanes"]>>);
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "opencode"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(mockTmuxSessionManager.sendTextToPane).toHaveBeenCalledWith(
        "%1",
        "opencode",
      );
      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "tmux attach-session -t project-a \\; set-option -u status off",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
    });

    it("starts OpenCode without prompting for newly created tmux sessions", async () => {
      setConfiguration({
        terminalBackend: "tmux" satisfies TerminalBackendType,
        defaultAiTool: "opencode",
        aiTools: [{ name: "opencode", label: "OpenCode", path: "", args: [] }],
      });
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "created" as const,
        session: {
          id: "project-a",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValue([
        { paneId: "%1", isActive: true },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listPanes"]>>);
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "opencode"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

    });

    it("warns and returns when tmux session has no panes", async () => {
      setConfiguration({
        terminalBackend: "tmux" satisfies TerminalBackendType,
        defaultAiTool: "opencode",
        aiTools: [{ name: "opencode", label: "OpenCode", path: "", args: [] }],
      });
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "created" as const,
        session: {
          id: "project-a",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValue([]);
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "opencode"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("no panes available"),
      );
      expect(mockTmuxSessionManager.sendTextToPane).not.toHaveBeenCalled();
    });

    it("warns when launching the startup tool in tmux fails", async () => {
      setConfiguration({
        terminalBackend: "tmux" satisfies TerminalBackendType,
        defaultAiTool: "opencode",
        aiTools: [{ name: "opencode", label: "OpenCode", path: "", args: [] }],
      });
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "created" as const,
        session: {
          id: "project-a",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(mockTmuxSessionManager.listPanes).mockRejectedValue(
        new Error("tmux unavailable"),
      );
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "opencode"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to launch tool in tmux session"),
      );
      expect(mockTmuxSessionManager.sendTextToPane).not.toHaveBeenCalled();
    });

    it("warns with a stringified non-Error when tmux launch fails", async () => {
      setConfiguration({
        terminalBackend: "tmux" satisfies TerminalBackendType,
        defaultAiTool: "opencode",
        aiTools: [{ name: "opencode", label: "OpenCode", path: "", args: [] }],
      });
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "created" as const,
        session: {
          id: "project-a",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(mockTmuxSessionManager.listPanes).mockRejectedValue("tmux unavailable");
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "opencode"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("tmux unavailable"),
      );
    });

    it("persists a preferred tool when switching tmux sessions", async () => {
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.spyOn(
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        },
        "startExternalChangeMonitoring",
      ).mockResolvedValue();

      await sessionRuntime.switchToTmuxSessionWithTool(
        "manual-tmux",
        "preferred-tool",
        {
          forceToolPrompt: true,
          respectPromptAiToolOnSession: true,
        },
      );

      expect(
        instanceStore.get("manual-tmux")?.config.selectedAiTool,
      ).toBeUndefined();
    });

    it("reuses an existing terminal for an instance and restores HTTP listeners", async () => {
      upsertInstance({ id: "instance-2", selectedAiTool: "preferred-tool" });
      sessionRuntime.setLastKnownTerminalSize(120, 40);

      vi.mocked(mockTerminalManager.getByInstance).mockReturnValue({
        port: 4312,
      } as ReturnType<TerminalManager["getByInstance"]>);
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveStoredTool: (
            instanceId?: string,
          ) => { name: string } | undefined;
        },
        "resolveStoredTool",
      ).mockReturnValue({ name: "preferred-tool" });
      vi.spyOn(sessionRuntime, "pollForHttpReadiness").mockResolvedValue();
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        supportsHttpApi: vi.fn(() => true),
      } as never);

      await sessionRuntime.switchToInstance("instance-2");

      expect(mockPortManager.releaseTerminalPorts).toHaveBeenCalledWith(
        "default",
      );
      expect(mockPortManager.releaseTerminalPorts).toHaveBeenCalledWith(
        "instance-2",
      );
      expect(postMessageMock).toHaveBeenCalledWith({ type: "clearTerminal" });
      expect(sessionRuntime.getActiveInstanceId()).toBe("instance-2");
      expect(sessionRuntime.isStartedFlag()).toBe(true);
      expect(mockTerminalManager.resizeTerminal).toHaveBeenCalledWith(
        "instance-2",
        120,
        40,
      );
      expect(sessionRuntime.getApiClient()).toBeDefined();
    });

    it("resolves active terminal backend ids from non-tmux runtime terminal keys", async () => {
      instanceStore.upsert({
        config: { id: "native-instance" },
        runtime: { terminalKey: "native-terminal-key" },
        state: "connected",
      });
      instanceStore.setActive("native-instance");
      (
        sessionRuntime as unknown as { activeInstanceId: string }
      ).activeInstanceId = "native-instance";

      expect(sessionRuntime.getActiveInstanceId()).toBe("native-instance");
      expect(sessionRuntime.getActiveTerminalId()).toBe("native-terminal-key");
    });

    it("force restarts an existing instance by killing its terminal and requesting a relaunch", async () => {
      upsertInstance({ id: "instance-2" });
      vi.mocked(mockTerminalManager.getByInstance).mockReturnValue({
        port: 4312,
      } as ReturnType<TerminalManager["getByInstance"]>);

      await sessionRuntime.switchToInstance("instance-2", {
        forceRestart: true,
        preferredToolName: "preferred-tool",
      });

      expect(mockTerminalManager.killByInstance).toHaveBeenCalledWith(
        "instance-2",
      );
      expect(mockTerminalManager.killTerminal).toHaveBeenCalledWith(
        "instance-2",
      );
      expect(requestStartOpenCodeMock).toHaveBeenCalled();
    });

    it("starts a native shell session and updates the instance store without tmux metadata", async () => {
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      (
        sessionRuntime as unknown as { forceNativeShellNextStart: boolean }
      ).forceNativeShellNextStart = true;

      await sessionRuntime.startOpenCode();

      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        undefined,
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
      expect(sessionRuntime.isStartedFlag()).toBe(true);
      expect(postMessageMock).toHaveBeenCalledWith({
        type: "activeSession",
        backend: "native",
      });
      expect(
        instanceStore.get("default")?.runtime.tmuxSessionId,
      ).toBeUndefined();
    });

    it("calls nativeTerminalManager.create() for native backend", async () => {
      setConfiguration({
        terminalBackend: "native" satisfies TerminalBackendType,
      });
      upsertInstance({
        workspaceUri: "file:///workspace/project-a",
        selectedAiTool: "preferred-tool",
      });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{
            name: string;
            args: string[];
          }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool", args: ["--chat"] });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(mockNativeTerminalManager.create).toHaveBeenCalledWith("default", {
        command: "run-tool",
        args: ["--chat"],
        cwd: "/workspace/project-a",
      });
      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "run-tool",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
      expect(instanceStore.get("default")?.config.terminalBackend).toBe(
        "native",
      );
      expect(instanceStore.get("default")?.runtime.terminalBackend).toBe(
        "native",
      );
    });

    it("starts a native backend even when no native terminal manager is provided", async () => {
      setConfiguration({
        terminalBackend: "native" satisfies TerminalBackendType,
      });
      upsertInstance({
        workspaceUri: "file:///workspace/project-a",
        selectedAiTool: "preferred-tool",
      });
      sessionRuntime.dispose();
      sessionRuntime = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        mockTmuxSessionManager,
        mockZellijSessionManager,
        backendRegistry,
        instanceStore,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{ name: string }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool" });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await expect(sessionRuntime.startOpenCode()).resolves.toBeUndefined();

      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "run-tool",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
      expect(instanceStore.get("default")?.runtime.terminalBackend).toBe(
        "native",
      );
      expect(
        instanceStore.get("default")?.runtime.backendState,
      ).toBeUndefined();
    });

    it("native instance saves backendState on startOpenCode", async () => {
      setConfiguration({
        terminalBackend: "native" satisfies TerminalBackendType,
      });
      upsertInstance({
        workspaceUri: "file:///workspace/project-a",
        selectedAiTool: "preferred-tool",
      });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{
            name: string;
            args: string[];
          }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool", args: ["--chat"] });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      const launchPlan = {
        backend: "native",
        restoreMode: "recreate" as const,
        launchSpec: {
          command: "run-tool",
          args: ["--chat"],
          cwd: "/workspace/project-a",
          name: "default",
        },
        state: {
          version: 1 as const,
          backend: "native" as const,
          restoreMode: "recreate" as const,
          launchSpec: {
            command: "run-tool",
            args: ["--chat"],
            cwd: "/workspace/project-a",
            name: "default",
          },
          createdAt: 12345,
        },
      } satisfies ReturnType<NativeTerminalManager["create"]>;
      vi.mocked(mockNativeTerminalManager.create).mockReturnValueOnce(
        launchPlan,
      );

      await sessionRuntime.startOpenCode();

      expect(instanceStore.get("default")?.runtime.backendState).toEqual({
        version: 1,
        backend: "native",
        restoreMode: "recreate",
        launchSpec: {
          command: "run-tool",
          args: ["--chat"],
          cwd: "/workspace/project-a",
          name: "default",
        },
        createdAt: 12345,
      });
    });

    it("ignores mismatched persisted backendState version during native startup", async () => {
      setConfiguration({
        terminalBackend: "native" satisfies TerminalBackendType,
      });
      instanceStore.upsert({
        config: {
          id: "default",
          workspaceUri: "file:///workspace/project-a",
          selectedAiTool: "preferred-tool",
          terminalBackend: "native",
        },
        runtime: {
          terminalKey: "default",
          terminalBackend: "native",
          backendState: {
            version: 99 as 1,
            backend: "native",
            restoreMode: "recreate",
            launchSpec: {
              command: "old-tool",
              cwd: "/workspace/project-a",
              name: "default",
            },
            createdAt: 1,
          },
        },
        state: "disconnected",
      });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{ name: string }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool" });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await expect(sessionRuntime.startOpenCode()).resolves.toBeUndefined();

      expect(mockNativeTerminalManager.create).toHaveBeenCalledWith("default", {
        command: "run-tool",
        args: undefined,
        cwd: "/workspace/project-a",
      });
      expect(instanceStore.get("default")?.runtime.backendState).toEqual(
        expect.objectContaining({
          version: 1,
          backend: "native",
        }),
      );
    });

    it("tmux instance does not save backendState", async () => {
      setConfiguration({
        terminalBackend: "tmux" satisfies TerminalBackendType,
      });
      instanceStore.upsert({
        config: {
          id: "default",
          workspaceUri: "file:///workspace/project-a",
          selectedAiTool: "preferred-tool",
        },
        runtime: {
          terminalKey: "default",
          backendState: {
            version: 1,
            backend: "native",
            restoreMode: "recreate",
            launchSpec: {
              command: "old-tool",
              cwd: "/workspace/project-a",
              name: "default",
            },
            createdAt: 1,
          },
        },
        state: "connected",
      });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{ name: string }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool" });
      vi.spyOn(
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        },
        "startExternalChangeMonitoring",
      ).mockResolvedValue();
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "created",
        session: {
          id: "workspace-session",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(instanceStore.get("default")?.runtime.terminalBackend).toBe(
        "tmux",
      );
      expect(
        instanceStore.get("default")?.runtime.backendState,
      ).toBeUndefined();
      expect(mockNativeTerminalManager.create).not.toHaveBeenCalled();
    });

    it("clears native backendState when switching through tmux and back to native shell", async () => {
      setConfiguration({
        terminalBackend: "native" satisfies TerminalBackendType,
      });
      upsertInstance({
        workspaceUri: "file:///workspace/project-a",
        selectedAiTool: "preferred-tool",
      });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{ name: string }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool" });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();
      expect(instanceStore.get("default")?.runtime.backendState?.backend).toBe(
        "native",
      );

      sessionRuntime.resetState(false);
      setConfiguration({
        terminalBackend: "tmux" satisfies TerminalBackendType,
      });
      vi.spyOn(
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        },
        "startExternalChangeMonitoring",
      ).mockResolvedValue();
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "created",
        session: {
          id: "workspace-session",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });

      await sessionRuntime.startOpenCode();

      expect(instanceStore.get("default")?.runtime.terminalBackend).toBe(
        "tmux",
      );
      expect(
        instanceStore.get("default")?.runtime.backendState,
      ).toBeUndefined();

      sessionRuntime.resetState(false);
      setConfiguration({
        terminalBackend: "native" satisfies TerminalBackendType,
      });
      await sessionRuntime.switchToNativeShell();
      requestStartOpenCodeMock.mockClear();
      await sessionRuntime.startOpenCode();

      expect(instanceStore.get("default")?.runtime.terminalBackend).toBe(
        "native",
      );
      expect(
        instanceStore.get("default")?.runtime.backendState,
      ).toBeUndefined();
      expect(instanceStore.get("default")?.runtime.tmuxSessionId).toBeUndefined();
    });

    it("legacy instance without backendState starts normally", async () => {
      setConfiguration({
        terminalBackend: "native" satisfies TerminalBackendType,
      });
      upsertInstance({
        workspaceUri: "file:///workspace/project-a",
        selectedAiTool: "preferred-tool",
      });
      sessionRuntime.dispose();
      sessionRuntime = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        mockTmuxSessionManager,
        mockZellijSessionManager,
        backendRegistry,
        instanceStore,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{ name: string }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool" });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await expect(sessionRuntime.startOpenCode()).resolves.toBeUndefined();

      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "run-tool",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
      expect(
        instanceStore.get("default")?.runtime.backendState,
      ).toBeUndefined();
    });

    it("launches the selected tool directly when tmux is unavailable", async () => {
      upsertInstance({
        workspaceUri: "file:///workspace/project-a",
        selectedAiTool: "preferred-tool",
      });
      sessionRuntime = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        undefined,
        undefined,
        new TerminalBackendRegistry([
          new StaticTerminalBackend("native", "Native", true),
          new StaticTerminalBackend("tmux", "Tmux", false),
          new StaticTerminalBackend("zellij", "Zellij", false),
        ]),
        instanceStore,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{ name: string }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool" });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => true),
      } as never);
      vi.mocked(mockPortManager.assignPortToTerminal).mockReturnValue(4312);
      vi.spyOn(sessionRuntime, "pollForHttpReadiness").mockResolvedValue();

      await sessionRuntime.startOpenCode();

      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "run-tool",
        {
          _EXTENSION_OPENCODE_PORT: "4312",
          OPENCODE_CALLER: "vscode",
        },
        4312,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
      expect(
        instanceStore.get("default")?.runtime.tmuxSessionId,
      ).toBeUndefined();
      expect(instanceStore.get("default")?.runtime.port).toBe(4312);
    });

    it("starts a native backend from the home directory when no workspace is open", async () => {
      setConfiguration({
        terminalBackend: "native" satisfies TerminalBackendType,
      });
      vscode.workspace.workspaceFolders = undefined;
      upsertInstance({ selectedAiTool: "preferred-tool" });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{ name: string }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool" });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(mockNativeTerminalManager.create).toHaveBeenCalledWith("default", {
        command: "run-tool",
        args: undefined,
        cwd: os.homedir(),
      });
      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "run-tool",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        os.homedir(),
      );
    });

    it("starts a tmux-backed tool session with HTTP enabled", async () => {
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<{ name: string }>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "preferred-tool" });
      vi.spyOn(
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        },
        "startExternalChangeMonitoring",
      ).mockResolvedValue();
      vi.spyOn(sessionRuntime, "pollForHttpReadiness").mockResolvedValue();
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "created",
        session: {
          id: "workspace-session",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-tool"),
        supportsHttpApi: vi.fn(() => true),
      } as never);
      vi.mocked(mockPortManager.assignPortToTerminal).mockReturnValue(4312);

      await sessionRuntime.startOpenCode();

      expect(mockTmuxSessionManager.configureMouseAndClipboard).toHaveBeenCalledWith(
        "workspace-session",
      );
      expect(mockTmuxSessionManager.registerSessionHooks).toHaveBeenCalledWith(
        "workspace-session",
        process.pid,
      );
      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "tmux attach-session -t workspace-session \\; set-option -u status off",
        {
          _EXTENSION_OPENCODE_PORT: "4312",
          OPENCODE_CALLER: "vscode",
        },
        4312,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
      expect(instanceStore.get("default")?.runtime.tmuxSessionId).toBe(
        "workspace-session",
      );
      expect(instanceStore.get("default")?.runtime.port).toBe(4312);
      expect(postMessageMock).toHaveBeenCalledWith({
        type: "activeSession",
        sessionName: "workspace-session",
        sessionId: "workspace-session",
        backend: "tmux",
      });
    });

    it("withLaunchEnvironment prepends port env vars when port is provided", () => {
      const runtime = sessionRuntime as unknown as {
        withLaunchEnvironment: (
          command: string,
          port: number | undefined,
        ) => string;
      };

      expect(runtime.withLaunchEnvironment("opencode", 30000)).toBe(
        "_EXTENSION_OPENCODE_PORT=30000 OPENCODE_CALLER=vscode opencode",
      );
      expect(runtime.withLaunchEnvironment("opencode", undefined)).toBe(
        "opencode",
      );
    });

    it("withLaunchEnvironment forwards IDE context vars into created tmux sessions", () => {
      const runtime = sessionRuntime as unknown as {
        withLaunchEnvironment: (
          command: string,
          port: number | undefined,
        ) => string;
      };
      const originalTermProgram = process.env.TERM_PROGRAM;
      const originalTermProgramVersion = process.env.TERM_PROGRAM_VERSION;
      const originalIpcHook = process.env.VSCODE_IPC_HOOK_CLI;
      const originalCodexSocket = process.env.CODEX_IDE_CONTEXT_SOCKET;

      try {
        process.env.TERM_PROGRAM = "vscode";
        delete process.env.TERM_PROGRAM_VERSION;
        process.env.VSCODE_IPC_HOOK_CLI = "/tmp/vscode hook.sock";
        process.env.CODEX_IDE_CONTEXT_SOCKET = "/tmp/codex-ipc/context.sock";

        expect(runtime.withLaunchEnvironment("codex", undefined)).toBe(
          "TERM_PROGRAM=vscode VSCODE_IPC_HOOK_CLI='/tmp/vscode hook.sock' CODEX_IDE_CONTEXT_SOCKET=/tmp/codex-ipc/context.sock codex",
        );
      } finally {
        if (originalTermProgram === undefined) {
          delete process.env.TERM_PROGRAM;
        } else {
          process.env.TERM_PROGRAM = originalTermProgram;
        }
        if (originalTermProgramVersion === undefined) {
          delete process.env.TERM_PROGRAM_VERSION;
        } else {
          process.env.TERM_PROGRAM_VERSION = originalTermProgramVersion;
        }
        if (originalIpcHook === undefined) {
          delete process.env.VSCODE_IPC_HOOK_CLI;
        } else {
          process.env.VSCODE_IPC_HOOK_CLI = originalIpcHook;
        }
        if (originalCodexSocket === undefined) {
          delete process.env.CODEX_IDE_CONTEXT_SOCKET;
        } else {
          process.env.CODEX_IDE_CONTEXT_SOCKET = originalCodexSocket;
        }
      }
    });
  });

  describe("HTTP readiness and auto-context", () => {
    it("marks HTTP as available when the API health check succeeds", async () => {
      (
        sessionRuntime as unknown as {
          apiClient?: { healthCheck: () => Promise<boolean> };
        }
      ).apiClient = {
        healthCheck: vi.fn().mockResolvedValue(true),
      };
      vi.spyOn(
        sessionRuntime as unknown as { sendAutoContext: () => Promise<void> },
        "sendAutoContext",
      ).mockResolvedValue();

      await sessionRuntime.pollForHttpReadiness();

      expect(sessionRuntime.isHttpAvailable()).toBe(true);
    });

    it("sends auto-context through the active operator when HTTP is ready", async () => {
      (sessionRuntime as unknown as { httpAvailable: boolean }).httpAvailable =
        true;
      (
        sessionRuntime as unknown as { activeTool?: { name: string } }
      ).activeTool = {
        name: "preferred-tool",
      };
      (
        sessionRuntime as unknown as {
          apiClient?: { appendPrompt: (value: string) => Promise<void> };
        }
      ).apiClient = {
        appendPrompt: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockContextSharingService.getCurrentContext).mockReturnValue({
        filePath: "src/providers/SessionRuntime.ts",
        selectionStart: 10,
        selectionEnd: 20,
      } as ReturnType<ContextSharingService["getCurrentContext"]>);
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        supportsAutoContext: vi.fn(() => true),
        formatFileReference: vi.fn(
          () => "@src/providers/SessionRuntime.ts#L10-L20",
        ),
      } as never);

      await (
        sessionRuntime as unknown as { sendAutoContext: () => Promise<void> }
      ).sendAutoContext();

      expect(
        (
          sessionRuntime as unknown as {
            apiClient?: { appendPrompt: ReturnType<typeof vi.fn> };
          }
        ).apiClient?.appendPrompt,
      ).toHaveBeenCalledWith("@src/providers/SessionRuntime.ts#L10-L20");
    });
  });

  describe("workspace and tmux resolution helpers", () => {
    it("prefers instance workspace, then workspace folder, then home directory for startup", () => {
      upsertInstance({
        workspaceUri: "file:///workspace/project-a",
      });
      expect(sessionRuntime.resolveStartupWorkspacePath()).toEqual({
        workspacePath: "/workspace/project-a",
        isWorkspaceScoped: true,
      });

      instanceStore.upsert({
        config: { id: "default", workspaceUri: undefined },
        runtime: { terminalKey: "default" },
        state: "connected",
      });
      expect(sessionRuntime.resolveStartupWorkspacePath()).toEqual({
        workspacePath: "/workspace/project-a",
        isWorkspaceScoped: true,
      });

      vscode.workspace.workspaceFolders = undefined;
      expect(sessionRuntime.resolveStartupWorkspacePath()).toEqual({
        workspacePath: os.homedir(),
        isWorkspaceScoped: false,
      });
    });

    it("ensures workspace sessions and handles tmux resolution failures gracefully", async () => {
      vi.mocked(mockTmuxSessionManager.ensureSession)
        .mockResolvedValueOnce({
          action: "attached",
          session: {
            id: "workspace-session",
            name: "project-a",
            workspace: "/workspace/project-a",
            isActive: true,
          },
        })
        .mockRejectedValueOnce(new TmuxUnavailableError())
        .mockRejectedValueOnce(new Error("boom"));

      await expect(
        sessionRuntime.ensureWorkspaceSession("/workspace/project-a"),
      ).resolves.toBe("workspace-session");
      await expect(
        sessionRuntime.ensureWorkspaceSession("/workspace/project-a"),
      ).resolves.toBeUndefined();
      await expect(
        sessionRuntime.ensureWorkspaceSession("/workspace/project-a"),
      ).resolves.toBeUndefined();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("tmux session attached"),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to ensure tmux session"),
      );
    });

    it("resolves fallback tmux sessions and warns on errors", async () => {
      vi.mocked(mockTmuxSessionManager.discoverSessions)
        .mockResolvedValueOnce([
          {
            id: "session-1",
            name: "one",
            workspace: "/workspace/one",
            isActive: false,
          },
          {
            id: "session-2",
            name: "two",
            workspace: "/workspace/two",
            isActive: true,
          },
        ])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error("discover failed"));

      await expect(sessionRuntime.resolveFallbackTmuxSessionId()).resolves.toBe(
        "session-2",
      );
      await expect(
        sessionRuntime.resolveFallbackTmuxSessionId(),
      ).resolves.toBeUndefined();
      await expect(
        sessionRuntime.resolveFallbackTmuxSessionId(),
      ).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to resolve fallback tmux session"),
      );
    });
  });

  describe("tmux session lifecycle helpers", () => {
    it("creates a unique tmux session name for the current workspace", async () => {
      vi.mocked(mockTmuxSessionManager.discoverSessions).mockResolvedValue([
        {
          id: "project-a",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
        {
          id: "project-a-2",
          name: "project-a-2",
          workspace: "/workspace/project-a",
          isActive: false,
        },
      ] as unknown as Awaited<
        ReturnType<TmuxSessionManager["discoverSessions"]>
      >);
      vi.mocked(mockTmuxSessionManager.createSession).mockResolvedValue();

      const switchSpy = vi
        .spyOn(sessionRuntime, "switchToTmuxSessionWithTool")
        .mockResolvedValue();

      await expect(sessionRuntime.createTmuxSession()).resolves.toBe(
        "project-a-3",
      );

      expect(mockTmuxSessionManager.createSession).toHaveBeenCalledWith(
        "project-a-3",
        "/workspace/project-a",
      );
      expect(switchSpy).toHaveBeenCalledWith("project-a-3", undefined, {
        forceToolPrompt: true,
        respectPromptAiToolOnSession: true,
      });
    });

    it("zooms the active pane", async () => {
      setActiveBackend("tmux");
      upsertInstance({
        tmuxSessionId: "workspace-session",
        workspaceUri: "file:///workspace/project-a",
      });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "attached" as const,
        session: {
          id: "workspace-session",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValue([
        { paneId: "%1", isActive: false },
        { paneId: "%2", isActive: true },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listPanes"]>>);

      setActiveBackend("tmux");
      vscode.workspace.workspaceFolders = undefined;
      await sessionRuntime.zoomTmuxPane();

      expect(mockTmuxSessionManager.zoomPane).toHaveBeenCalledWith("%2");
    });

    it("zooms the focused zellij pane without tmux pane lookup", async () => {
      setActiveBackend("zellij");

      await sessionRuntime.zoomTmuxPane();

      expect(mockZellijSessionManager.zoomPane).toHaveBeenCalled();
      expect(mockTmuxSessionManager.listPanes).not.toHaveBeenCalled();
      expect(mockTmuxSessionManager.zoomPane).not.toHaveBeenCalled();
    });

    it("kills tmux sessions and switches to a replacement workspace session when available", async () => {
      setActiveBackend("tmux");
      vscode.workspace.workspaceFolders = [
        { uri: { fsPath: "/workspace/project-a" }, name: "project-a", index: 0 },
      ];
      upsertInstance({
        tmuxSessionId: "workspace-session",
        workspaceUri: "file:///workspace/project-a",
      });
      (sessionRuntime as unknown as { isStarted: boolean }).isStarted = true;
      (
        sessionRuntime as unknown as { selectedTmuxSessionId?: string }
      ).selectedTmuxSessionId = "workspace-session";

      vi.mocked(
        mockTmuxSessionManager.findSessionForWorkspace,
      ).mockResolvedValue({
        id: "replacement-session",
      } as Awaited<ReturnType<TmuxSessionManager["findSessionForWorkspace"]>>);

      const switchSpy = vi
        .spyOn(sessionRuntime, "switchToTmuxSessionWithTool")
        .mockResolvedValue();

      await sessionRuntime.killTmuxSession("workspace-session");

      expect(mockTmuxSessionManager.killSession).toHaveBeenCalledWith(
        "workspace-session",
      );
      expect(
        instanceStore.get("default")?.runtime.tmuxSessionId,
      ).toBeUndefined();
      expect(switchSpy).toHaveBeenCalledWith("replacement-session", undefined, {
        forceToolPrompt: true,
        respectPromptAiToolOnSession: true,
      });
      expect(mockPortManager.releaseTerminalPorts).toHaveBeenCalledWith(
        "default",
      );
    });

    it("falls back to native shell after killing the active tmux session when no replacement exists", async () => {
      setActiveBackend("tmux");
      upsertInstance({
        tmuxSessionId: "workspace-session",
        workspaceUri: "file:///workspace/project-a",
      });
      (sessionRuntime as unknown as { isStarted: boolean }).isStarted = true;

      const nativeShellSpy = vi
        .spyOn(sessionRuntime, "switchToNativeShell")
        .mockResolvedValue();

      await sessionRuntime.killTmuxSession("workspace-session");

      expect(nativeShellSpy).toHaveBeenCalled();
    });

    it("kills zellij sessions through the zellij manager", async () => {
      setActiveBackend("zellij");
      upsertInstance({ zellijSessionId: "zellij-session" });
      (sessionRuntime as unknown as { isStarted: boolean }).isStarted = true;

      const nativeShellSpy = vi
        .spyOn(sessionRuntime, "switchToNativeShell")
        .mockResolvedValue();

      await sessionRuntime.killTmuxSession("zellij-session");

      expect(mockZellijSessionManager.killSession).toHaveBeenCalledWith(
        "zellij-session",
      );
      expect(mockTmuxSessionManager.killSession).not.toHaveBeenCalled();
      expect(
        instanceStore.get("default")?.runtime.zellijSessionId,
      ).toBeUndefined();
      expect(mockPortManager.releaseTerminalPorts).toHaveBeenCalledWith(
        "default",
      );
      expect(nativeShellSpy).toHaveBeenCalled();
    });
  });

  describe("pane routing and formatting helpers", () => {
    it("routes dropped text into the pane under the drop coordinates", async () => {
      setActiveBackend("tmux");
      upsertInstance({
        tmuxSessionId: "workspace-session",
        workspaceUri: "file:///workspace/project-a",
      });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "attached" as const,
        session: {
          id: "workspace-session",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(
        mockTmuxSessionManager.listVisiblePaneGeometry,
      ).mockResolvedValue([
        {
          paneId: "%1",
          paneLeft: 0,
          paneTop: 0,
          paneWidth: 10,
          paneHeight: 10,
        },
        {
          paneId: "%2",
          paneLeft: 10,
          paneTop: 0,
          paneWidth: 10,
          paneHeight: 10,
        },
      ] as unknown as Awaited<
        ReturnType<TmuxSessionManager["listVisiblePaneGeometry"]>
      >);

      await expect(
        sessionRuntime.routeDroppedTextToTmuxPane("hello", { col: 12, row: 2 }),
      ).resolves.toBe(true);

      expect(mockTmuxSessionManager.selectPane).toHaveBeenCalledWith("%2");
      expect(mockTmuxSessionManager.sendTextToPane).toHaveBeenCalledWith(
        "%2",
        "hello",
        { submit: false },
      );
    });

    it("returns false when dropped text does not intersect any pane", async () => {
      setActiveBackend("tmux");
      upsertInstance({ tmuxSessionId: "workspace-session" });
      vi.mocked(
        mockTmuxSessionManager.listVisiblePaneGeometry,
      ).mockResolvedValue([
        { paneId: "%1", paneLeft: 0, paneTop: 0, paneWidth: 5, paneHeight: 5 },
      ] as unknown as Awaited<
        ReturnType<TmuxSessionManager["listVisiblePaneGeometry"]>
      >);

      await expect(
        sessionRuntime.routeDroppedTextToTmuxPane("hello", {
          col: 20,
          row: 20,
        }),
      ).resolves.toBe(false);
      expect(mockTmuxSessionManager.selectPane).not.toHaveBeenCalled();
    });

    it("uses the active operator for dropped files, file references, and pasted images", () => {
      (
        sessionRuntime as unknown as { activeTool?: { name: string } }
      ).activeTool = {
        name: "preferred-tool",
      };
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        formatDroppedFiles: vi.fn(() => "@a @b"),
        formatFileReference: vi.fn(() => "@file.ts#L1-L5"),
        formatPastedImage: vi.fn(() => "@image.png"),
      } as never);

      expect(
        sessionRuntime.formatDroppedFiles(["a", "b"], { useAtSyntax: true }),
      ).toBe("@a @b");
      expect(
        sessionRuntime.formatFileReference({
          path: "file.ts",
          selectionStart: 1,
          selectionEnd: 5,
        }),
      ).toBe("@file.ts#L1-L5");
      expect(sessionRuntime.formatPastedImage("image.png")).toBe("@image.png");
    });
  });

  describe("accessors, selection, and listener edge cases", () => {
    it("reports active tool, terminal size, backend availability, and live process state", () => {
      sessionRuntime.setLastKnownTerminalSize(132, 43);
      (
        sessionRuntime as unknown as { activeTool?: AiToolConfig }
      ).activeTool = {
        name: "codex",
        label: "Codex",
        path: "codex",
        args: [],
      };
      vi.mocked(mockTerminalManager.getTerminal).mockReturnValue(
        {} as ReturnType<TerminalManager["getTerminal"]>,
      );
      (sessionRuntime as unknown as { isStarted: boolean }).isStarted = true;

      expect(sessionRuntime.getLastKnownTerminalSize()).toEqual({
        cols: 132,
        rows: 43,
      });
      expect(sessionRuntime.getActiveTool()?.name).toBe("codex");
      expect(sessionRuntime.getBackendAvailability()).toEqual({
        native: true,
        tmux: true,
        zellij: true,
      });
      expect(sessionRuntime.hasLiveTerminalProcess()).toBe(true);
    });

    it("resolves and remembers configured tools", () => {
      setConfiguration({
        aiTools: [
          {
            name: "codex",
            label: "Codex",
            path: "codex",
            args: ["--ask"],
          },
        ],
      });
      upsertInstance();

      expect(sessionRuntime.resolveToolByName("codex")?.label).toBe("Codex");
      sessionRuntime.rememberSelectedTool("codex");

      expect(instanceStore.get("default")?.config.selectedAiTool).toBe("codex");
      expect(sessionRuntime.getActiveTool()?.name).toBe("codex");
    });

    it("cycles through available backends and falls back when sessions cannot be created", async () => {
      const selectSpy = vi.spyOn(sessionRuntime, "selectTerminalBackend");

      await sessionRuntime.cycleTerminalBackend();

      expect(selectSpy).toHaveBeenCalledWith("tmux");

      selectSpy.mockRestore();
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue(
        undefined as unknown as Awaited<
          ReturnType<TmuxSessionManager["ensureSession"]>
        >,
      );
      const nativeSpy = vi
        .spyOn(sessionRuntime, "switchToNativeShell")
        .mockResolvedValue();

      await sessionRuntime.selectTerminalBackend("tmux");

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        "Tmux session could not be created. Falling back to native shell.",
      );
      expect(nativeSpy).toHaveBeenCalled();

      vi.mocked(mockZellijSessionManager.ensureSession).mockResolvedValue(
        undefined as unknown as Awaited<
          ReturnType<ZellijSessionManager["ensureSession"]>
        >,
      );
      await sessionRuntime.selectTerminalBackend("zellij");

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        "Zellij session could not be created. Falling back to native shell.",
      );
    });

    it("switches directly to native when native backend is selected", async () => {
      const nativeSpy = vi
        .spyOn(sessionRuntime, "switchToNativeShell")
        .mockResolvedValue();

      await sessionRuntime.selectTerminalBackend("native");

      expect(nativeSpy).toHaveBeenCalled();
    });

    it("keeps existing active instance without force restart", async () => {
      await sessionRuntime.switchToInstance("default");

      expect(requestStartOpenCodeMock).not.toHaveBeenCalled();
      expect(postMessageMock).not.toHaveBeenCalledWith({
        type: "clearTerminal",
      });
    });

    it("posts terminal output only for the active instance and exits native terminals normally", () => {
      let dataHandler: ((event: { id: string; data: string }) => void) | undefined;
      vi.mocked(mockTerminalManager.onData).mockImplementation((handler) => {
        dataHandler = handler;
        return { dispose: vi.fn() };
      });
      registerDefaultSession();

      sessionRuntime.reconnectListeners();
      dataHandler?.({ id: "other", data: "ignored" });
      dataHandler?.({ id: "default", data: "hello" });
      exitHandler?.("default");

      expect(postMessageMock).toHaveBeenCalledWith({
        type: "terminalOutput",
        data: "hello",
      });
      expect(postMessageMock).toHaveBeenCalledWith({ type: "terminalExited" });
    });

    it("restarts by killing the active terminal and requesting a fresh launch", () => {
      registerDefaultSession();

      sessionRuntime.restart();

      expect(mockTerminalManager.killTerminal).toHaveBeenCalledWith("default");
      expect(mockTerminalManager.killByInstance).toHaveBeenCalledWith("default");
      expect(postMessageMock).toHaveBeenCalledWith({ type: "clearTerminal" });
      expect(requestStartOpenCodeMock).toHaveBeenCalled();
    });
  });

  describe("startup fallback and persistence branches", () => {
    it("does not start twice while started or starting", async () => {
      (sessionRuntime as unknown as { isStarted: boolean }).isStarted = true;
      await sessionRuntime.startOpenCode();
      (sessionRuntime as unknown as { isStarted: boolean }).isStarted = false;
      (sessionRuntime as unknown as { isStarting: boolean }).isStarting = true;
      await sessionRuntime.startOpenCode();

      expect(mockTerminalManager.createTerminal).not.toHaveBeenCalled();
    });

    it("falls back to native when tmux has no available session", async () => {
      setConfiguration({ terminalBackend: "tmux" satisfies TerminalBackendType });
      upsertInstance({ selectedAiTool: "codex" });
      vi.mocked(mockTmuxSessionManager.discoverSessions).mockResolvedValue([]);
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<AiToolConfig>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "codex", label: "Codex", path: "", args: [] });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "codex"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(sessionRuntime.getActiveBackend()).toBe("native");
      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "codex",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
    });

    it("validates stored zellij sessions and clears stale explicit selections", async () => {
      setConfiguration({ terminalBackend: "zellij" satisfies TerminalBackendType });
      upsertInstance({ zellijSessionId: "stale", selectedAiTool: "codex" });
      (
        sessionRuntime as unknown as { selectedZellijSessionId?: string }
      ).selectedZellijSessionId = "stale";
      vi.mocked(mockZellijSessionManager.discoverSessions).mockResolvedValue([]);
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<AiToolConfig>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "codex", label: "Codex", path: "", args: [] });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "codex"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("no longer exists"),
      );
      expect(sessionRuntime.getActiveBackend()).toBe("native");
    });

    it("returns early when startup tool selection is cancelled", async () => {
      setConfiguration({ terminalBackend: "native" satisfies TerminalBackendType });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<AiToolConfig | undefined>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue(undefined);

      await sessionRuntime.startOpenCode();

      expect(mockTerminalManager.createTerminal).not.toHaveBeenCalled();
      expect(sessionRuntime.isStartedFlag()).toBe(false);
    });

    it("handles HTTP port assignment failures without aborting startup", async () => {
      setConfiguration({ terminalBackend: "native" satisfies TerminalBackendType });
      upsertInstance({ selectedAiTool: "codex" });
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<AiToolConfig>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "codex", label: "Codex", path: "", args: [] });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "codex"),
        supportsHttpApi: vi.fn(() => true),
      } as never);
      vi.mocked(mockPortManager.assignPortToTerminal).mockImplementation(() => {
        throw new Error("no ports");
      });

      await sessionRuntime.startOpenCode();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        "Failed to assign port for OpenCode HTTP API. Running without HTTP features.",
      );
      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "codex",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
    });

    it("creates a fresh instance record when none exists", async () => {
      setConfiguration({ terminalBackend: "native" satisfies TerminalBackendType });
      instanceStore.remove("default");
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<AiToolConfig>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "codex", label: "Codex", path: "", args: [] });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "codex"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(instanceStore.get("default")?.runtime.terminalBackend).toBe(
        "native",
      );
    });

    it("logs instance-store update failures", async () => {
      setConfiguration({ terminalBackend: "native" satisfies TerminalBackendType });
      upsertInstance();
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<AiToolConfig>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "codex", label: "Codex", path: "", args: [] });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "codex"),
        supportsHttpApi: vi.fn(() => false),
      } as never);
      vi.spyOn(instanceStore, "upsert").mockImplementation(() => {
        throw new Error("store read failed");
      });

      await sessionRuntime.startOpenCode();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to update instance store"),
      );
    });
  });

  describe("zellij and backend resolution helpers", () => {
    it("resolves configured backends and defaults invalid values to tmux", () => {
      expect(
        sessionRuntime.resolveConfiguredBackend({
          get: vi.fn(() => "zellij"),
        } as unknown as vscodeApi.WorkspaceConfiguration),
      ).toBe("zellij");
      expect(
        sessionRuntime.resolveConfiguredBackend({
          get: vi.fn(() => "bogus"),
        } as unknown as vscodeApi.WorkspaceConfiguration),
      ).toBe("tmux");
    });

    it("resolves fallback zellij sessions by workspace and active session", async () => {
      vi.mocked(mockZellijSessionManager.discoverSessions)
        .mockResolvedValueOnce([
          {
            id: "project-a",
            name: "project-a",
            workspace: "/workspace/project-a",
            isActive: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "project-a",
            name: "project-a",
            workspace: "/workspace/project-a",
            isActive: false,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "other",
            name: "Other",
            workspace: "/workspace/other",
            isActive: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "active",
            name: "Active",
            workspace: "/workspace/active",
            isActive: true,
          },
          {
            id: "first",
            name: "First",
            workspace: "/workspace/first",
            isActive: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error("zellij failed"));

      await expect(
        sessionRuntime.resolveFallbackZellijSessionId("/workspace/project-a"),
      ).resolves.toBe("project-a");
      await expect(
        sessionRuntime.resolveFallbackZellijSessionId("/workspace/project-a"),
      ).resolves.toBe("project-a");
      await expect(
        sessionRuntime.resolveFallbackZellijSessionId("/workspace/project-a"),
      ).resolves.toBeUndefined();
      await expect(
        sessionRuntime.resolveFallbackZellijSessionId(),
      ).resolves.toBe("active");
      await expect(
        sessionRuntime.resolveFallbackZellijSessionId(),
      ).resolves.toBeUndefined();
      await expect(
        sessionRuntime.resolveFallbackZellijSessionId(),
      ).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to resolve fallback zellij session"),
      );
    });

    it("ensures zellij workspace sessions and warns on failure", async () => {
      vi.mocked(mockZellijSessionManager.ensureSession)
        .mockResolvedValueOnce({
          action: "created",
          session: {
            id: "project-a",
            name: "project-a",
            workspace: "/workspace/project-a",
            isActive: true,
          },
        })
        .mockRejectedValueOnce(new Error("cannot create"));

      await expect(
        sessionRuntime.ensureZellijWorkspaceSession("/workspace/project-a"),
      ).resolves.toBe("project-a");
      await expect(
        sessionRuntime.ensureZellijWorkspaceSession("/workspace/project-a"),
      ).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to ensure zellij session"),
      );
    });

    it("uses selected, stored, and instance-store mapped backend sessions", async () => {
      upsertInstance({ id: "z", zellijSessionId: "zellij-session" });
      upsertInstance({ id: "t", tmuxSessionId: "tmux-session" });

      expect(sessionRuntime.resolveZellijSessionIdForInstance("z")).toBe(
        "zellij-session",
      );
      expect(sessionRuntime.resolveTmuxSessionIdForInstance("t")).toBe(
        "tmux-session",
      );
      await sessionRuntime.killTmuxSession("zellij-session");
      expect(mockZellijSessionManager.killSession).toHaveBeenCalledWith(
        "zellij-session",
      );
    });

    it("handles no-manager helper variants", async () => {
      const runtimeWithoutManagers = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        undefined,
        undefined,
        backendRegistry,
        undefined,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );

      await expect(
        runtimeWithoutManagers.resolveFallbackTmuxSessionId(),
      ).resolves.toBeUndefined();
      await expect(
        runtimeWithoutManagers.resolveFallbackZellijSessionId(),
      ).resolves.toBeUndefined();
      await expect(
        runtimeWithoutManagers.ensureWorkspaceSession("/workspace/project-a"),
      ).resolves.toBeUndefined();
      await expect(
        runtimeWithoutManagers.ensureZellijWorkspaceSession(
          "/workspace/project-a",
        ),
      ).resolves.toBeUndefined();
      await expect(
        runtimeWithoutManagers.createTmuxSession(),
      ).resolves.toBeUndefined();
      expect(runtimeWithoutManagers.getActiveTerminalId()).toBe(
        "opencode-main",
      );
      runtimeWithoutManagers.dispose();
    });
  });

  describe("HTTP readiness, auto-context, and tool selection branches", () => {
    it("handles missing and permanently unavailable HTTP API clients", async () => {
      await sessionRuntime.pollForHttpReadiness();
      expect(sessionRuntime.isHttpAvailable()).toBe(false);

      (
        sessionRuntime as unknown as {
          apiClient?: { healthCheck: () => Promise<boolean> };
        }
      ).apiClient = {
        healthCheck: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockRejectedValue(new Error("down")),
      };
      vi.spyOn(sessionRuntime, "sleep").mockResolvedValue();

      await sessionRuntime.pollForHttpReadiness();

      expect(mockLogger.info).toHaveBeenCalledWith(
        "[TerminalProvider] HTTP API not available after retries, using message passing fallback",
      );
      expect(sessionRuntime.isHttpAvailable()).toBe(false);
    });

    it("sleeps for the requested delay", async () => {
      vi.useFakeTimers();
      const slept = sessionRuntime.sleep(25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(slept).resolves.toBeUndefined();
      vi.useRealTimers();
    });

    it("skips auto-context for every disabled precondition and logs append failures", async () => {
      const sendAutoContext = () =>
        (
          sessionRuntime as unknown as { sendAutoContext: () => Promise<void> }
        ).sendAutoContext();
      (
        sessionRuntime as unknown as { activeTool?: AiToolConfig }
      ).activeTool = { name: "codex", label: "Codex", path: "", args: [] };
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        supportsAutoContext: vi.fn(() => true),
        formatFileReference: vi.fn(() => "@file"),
      } as never);

      setConfiguration({ enableHttpApi: false });
      await sendAutoContext();
      setConfiguration({ autoShareContext: false });
      await sendAutoContext();
      setConfiguration();
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        supportsAutoContext: vi.fn(() => false),
      } as never);
      await sendAutoContext();

      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        supportsAutoContext: vi.fn(() => true),
      } as never);
      await sendAutoContext();

      (sessionRuntime as unknown as { httpAvailable: boolean }).httpAvailable =
        true;
      (
        sessionRuntime as unknown as {
          apiClient?: { appendPrompt: (value: string) => Promise<void> };
        }
      ).apiClient = { appendPrompt: vi.fn().mockRejectedValue(new Error("no")) };
      vi.mocked(mockContextSharingService.getCurrentContext).mockReturnValue(
        null,
      );
      await sendAutoContext();

      vi.mocked(mockContextSharingService.getCurrentContext).mockReturnValue({
        filePath: "file.ts",
      } as ReturnType<ContextSharingService["getCurrentContext"]>);
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        supportsAutoContext: vi.fn(() => true),
        formatFileReference: vi.fn(() => "@file.ts"),
      } as never);
      await sendAutoContext();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send auto-context"),
      );
    });

    it("returns undefined when the configured startup tool cannot be resolved", async () => {
      const updateMock = vi.fn(async () => undefined);
      setConfiguration({
        aiTools: [
          { name: "codex", label: "Codex", path: "", args: [] },
        ],
        defaultAiTool: "",
      });
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn(<T,>(key: string, defaultValue?: T): T => {
          if (key === "aiTools") {
            return [
              { name: "codex", label: "Codex", path: "", args: [] },
            ] as T;
          }
          return (defaultValue ?? "") as T;
        }),
        inspect: vi.fn(() => undefined),
        update: updateMock,
      } as ReturnType<typeof vscode.workspace.getConfiguration>);
      upsertInstance();

      const tool = await (
        sessionRuntime as unknown as {
          resolveToolForStartup: (
            config: vscodeApi.WorkspaceConfiguration,
          ) => Promise<AiToolConfig | undefined>;
        }
      ).resolveToolForStartup(
        vscode.workspace.getConfiguration() as unknown as vscodeApi.WorkspaceConfiguration,
      );

      expect(tool).toBeUndefined();
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("does not persist an unresolved startup tool as default", async () => {
      const updateMock = vi.fn(async () => undefined);
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn(<T,>(key: string, defaultValue?: T): T => {
          if (key === "aiTools") {
            return [
              { name: "codex", label: "Codex", path: "", args: [] },
            ] as T;
          }
          return (defaultValue ?? "") as T;
        }),
        inspect: vi.fn(() => undefined),
        update: updateMock,
      } as ReturnType<typeof vscode.workspace.getConfiguration>);
      upsertInstance();

      const tool = await (
        sessionRuntime as unknown as {
          resolveToolForStartup: (
            config: vscodeApi.WorkspaceConfiguration,
          ) => Promise<AiToolConfig | undefined>;
        }
      ).resolveToolForStartup(
        vscode.workspace.getConfiguration() as unknown as vscodeApi.WorkspaceConfiguration,
      );

      expect(tool).toBeUndefined();
      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(instanceStore.get("default")?.config.selectedAiTool).toBeUndefined();
    });

    it("returns undefined when startup tool selection is dismissed", async () => {
      setConfiguration({
        aiTools: [{ name: "codex", label: "Codex", path: "", args: [] }],
        defaultAiTool: "",
      });
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      await expect(
        (
          sessionRuntime as unknown as {
            resolveToolForStartup: (
              config: vscodeApi.WorkspaceConfiguration,
            ) => Promise<AiToolConfig | undefined>;
          }
        ).resolveToolForStartup(
          vscode.workspace.getConfiguration() as unknown as vscodeApi.WorkspaceConfiguration,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("pane monitoring, clipboard sync, and routing branches", () => {
    it("starts tmux monitoring, reacts to callbacks, and stops cleanly", async () => {
      vi.useFakeTimers();
      setActiveBackend("tmux");
      const dispose = vi.fn();
      let externalCallback: ((event: string) => void) | undefined;
      vi.mocked(mockTmuxSessionManager.onExternalPaneChange).mockImplementation(
        (callback) => {
          externalCallback = callback;
          return { dispose };
        },
      );
      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValue([
        { paneId: "%1", isActive: true, currentCommand: "bash" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listPanes"]>>);
      vi.mocked(mockTmuxSessionManager.listWindows).mockResolvedValue([
        { windowId: "@1", isActive: true, index: 1, name: "main" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listWindows"]>>);

      await (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring("session");
      externalCallback?.("pane-change");
      process.emit("SIGUSR2");
      await vi.runOnlyPendingTimersAsync();
      (
        sessionRuntime as unknown as { stopExternalChangeMonitoring: () => void }
      ).stopExternalChangeMonitoring();

      expect(dispose).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("initializes zellij monitoring, including failed initialization", async () => {
      vi.useFakeTimers();
      setActiveBackend("zellij");
      vi.mocked(mockZellijSessionManager.listPanes).mockRejectedValueOnce(
        new Error("panes failed"),
      );

      await (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring("zellij-session");

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to initialize pane monitoring"),
      );
      vi.useRealTimers();
    });

    it("checks zellij pane changes using discovered sessions and logs errors", async () => {
      setActiveBackend("zellij");
      vi.mocked(mockZellijSessionManager.discoverSessions)
        .mockResolvedValueOnce([
          { id: "z1", name: "z1", workspace: "/workspace/z1", isActive: true },
        ])
        .mockRejectedValueOnce(new Error("discover"));
      vi.mocked(mockZellijSessionManager.listPanes)
        .mockResolvedValueOnce([
          { id: "p1", title: "shell", isFocused: true, isFloating: false },
        ])
        .mockRejectedValueOnce(new Error("list"));
      vi.mocked(mockZellijSessionManager.listTabs).mockResolvedValue([
        { index: 2, name: "tab", isActive: true },
      ]);

      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();
      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();

      expect(postMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "z1", windowIndex: 2 }),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to discover zellij sessions"),
      );
    });

    it("checks tmux pane changes no-session and error branches", async () => {
      setActiveBackend("tmux");
      vi.mocked(mockTmuxSessionManager.discoverSessions)
        .mockRejectedValueOnce(new Error("discover"))
        .mockResolvedValueOnce([
          { id: "s1", name: "s1", workspace: "/workspace/s1", isActive: false },
        ])
        .mockResolvedValueOnce([
          { id: "s1", name: "s1", workspace: "/workspace/s1", isActive: false },
        ]);
      vi.mocked(mockTmuxSessionManager.listPanes)
        .mockRejectedValueOnce(new Error("list panes"))
        .mockResolvedValueOnce([
          { paneId: "%1", isActive: true, currentCommand: "bash" },
          { paneId: "%2", isActive: false, currentCommand: "zsh" },
        ] as unknown as Awaited<ReturnType<TmuxSessionManager["listPanes"]>>);
      vi.mocked(mockTmuxSessionManager.listWindows).mockResolvedValue([
        { windowId: "@1", isActive: true, index: 1, name: "main" },
        { windowId: "@2", isActive: false, index: 2, name: "side" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listWindows"]>>);

      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();
      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();
      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to discover tmux sessions"),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to check tmux pane changes"),
      );
      expect(postMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "s1", canKillPane: true }),
      );
    });

    it("syncs tmux clipboard only when buffers change", async () => {
      vi.useFakeTimers();
      setActiveBackend("tmux");
      vi.mocked(mockTmuxSessionManager.showBuffer)
        .mockResolvedValueOnce("copied")
        .mockResolvedValueOnce("copied")
        .mockRejectedValueOnce(new Error("buffer"));

      (
        sessionRuntime as unknown as { startClipboardSync: () => void }
      ).startClipboardSync();
      await vi.advanceTimersByTimeAsync(1500);
      (
        sessionRuntime as unknown as { stopClipboardSync: () => void }
      ).stopClipboardSync();

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith("copied");
      vi.useRealTimers();
    });

    it("routes dropped text to zellij and handles routing failures", async () => {
      setActiveBackend("zellij");
      await expect(
        sessionRuntime.routeDroppedTextToTmuxPane("hello", { col: 1, row: 1 }),
      ).resolves.toBe(true);
      vi.mocked(mockZellijSessionManager.sendTextToPane).mockRejectedValueOnce(
        new Error("send"),
      );
      await expect(
        sessionRuntime.routeDroppedTextToTmuxPane("hello", { col: 1, row: 1 }),
      ).resolves.toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to route dropped text to zellij pane"),
      );
    });

    it("returns false when tmux routing has no manager, no session, or errors", async () => {
      const runtimeWithoutManagers = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        undefined,
        undefined,
        backendRegistry,
        instanceStore,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      (
        runtimeWithoutManagers as unknown as { activeBackend: TerminalBackendType }
      ).activeBackend = "tmux";
      await expect(
        runtimeWithoutManagers.routeDroppedTextToTmuxPane("x", { col: 0, row: 0 }),
      ).resolves.toBe(false);

      setActiveBackend("tmux");
      vscode.workspace.workspaceFolders = undefined;
      await expect(
        sessionRuntime.routeDroppedTextToTmuxPane("x", { col: 0, row: 0 }),
      ).resolves.toBe(false);

      vscode.workspace.workspaceFolders = [
        { uri: { fsPath: "/workspace/project-a" }, name: "project-a", index: 0 },
      ];
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "attached",
        session: { id: "s", name: "s", workspace: "/workspace/project-a", isActive: true },
      });
      vi.mocked(
        mockTmuxSessionManager.listVisiblePaneGeometry,
      ).mockRejectedValueOnce(new Error("geometry"));
      await expect(
        sessionRuntime.routeDroppedTextToTmuxPane("x", { col: 0, row: 0 }),
      ).resolves.toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to route dropped text to tmux pane"),
      );
      runtimeWithoutManagers.dispose();
    });
  });

  describe("session kill, formatting, and private fallback branches", () => {
    it("ignores native and missing-manager kill requests and reports manager failures", async () => {
      await sessionRuntime.killTmuxSession("anything");
      expect(mockTmuxSessionManager.killSession).toHaveBeenCalledWith(
        "anything",
      );

      vi.mocked(mockTmuxSessionManager.killSession).mockRejectedValueOnce(
        new Error("kill failed"),
      );
      await sessionRuntime.killTmuxSession("anything");
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "Failed to kill tmux session",
      );

      const runtimeWithoutManagers = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        undefined,
        undefined,
        backendRegistry,
        undefined,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      await expect(
        runtimeWithoutManagers.killTmuxSession("anything"),
      ).resolves.toBeUndefined();
      runtimeWithoutManagers.dispose();
    });

    it("handles zellij session kill failures", async () => {
      setActiveBackend("zellij");
      vi.mocked(mockZellijSessionManager.killSession).mockRejectedValueOnce(
        new Error("zellij kill"),
      );

      await sessionRuntime.killTmuxSession("zellij-session");

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "Failed to kill zellij session",
      );
    });

    it("handles create and zoom failure variants", async () => {
      vi.mocked(mockTmuxSessionManager.discoverSessions).mockRejectedValueOnce(
        new Error("discover"),
      );
      await expect(sessionRuntime.createTmuxSession()).resolves.toBeUndefined();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "Failed to create tmux session",
      );

      setActiveBackend("tmux");
      vscode.workspace.workspaceFolders = undefined;
      await sessionRuntime.zoomTmuxPane();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Cannot zoom tmux pane"),
      );

      setActiveBackend("tmux");
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "attached",
        session: { id: "s", name: "s", workspace: "/workspace/project-a", isActive: true },
      });
      vi.mocked(mockTmuxSessionManager.listPanes).mockRejectedValueOnce(
        new Error("panes"),
      );
      await sessionRuntime.zoomTmuxPane();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to zoom tmux pane"),
      );

      setActiveBackend("zellij");
      vi.mocked(mockZellijSessionManager.zoomPane).mockRejectedValueOnce(
        new Error("zoom"),
      );
      await sessionRuntime.zoomTmuxPane();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to zoom zellij pane"),
      );
    });

    it("falls back to raw strings when no formatting operator exists", () => {
      vi.mocked(mockAiToolRegistry.getByToolName).mockReturnValue(undefined);

      expect(sessionRuntime.formatDroppedFiles(["a", "b"], { useAtSyntax: true })).toBe(
        "a b",
      );
      expect(sessionRuntime.formatFileReference({ path: "file.ts" })).toBe(
        "file.ts",
      );
      expect(sessionRuntime.formatPastedImage("image.png")).toBeUndefined();
    });

    it("handles malformed workspace URIs and missing instance stores", () => {
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(vscode.Uri.parse).mockImplementationOnce(() => {
        throw new Error("bad uri");
      });
      expect(sessionRuntime.resolveWorkspacePathFromActiveInstance()).toBeUndefined();

      const runtimeWithoutStore = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        mockTmuxSessionManager,
        mockZellijSessionManager,
        backendRegistry,
        undefined,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      expect(runtimeWithoutStore.resolveWorkspacePathFromActiveInstance()).toBeUndefined();
      expect(runtimeWithoutStore.resolveTmuxSessionIdForInstance("x")).toBeUndefined();
      expect(runtimeWithoutStore.resolveZellijSessionIdForInstance("x")).toBeUndefined();
      runtimeWithoutStore.dispose();
    });
  });

  describe("remaining defensive branches", () => {
    it("selects tmux when backend session creation succeeds", async () => {
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "created",
        session: {
          id: "project-a",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      const switchSpy = vi
        .spyOn(sessionRuntime, "switchToTmuxSessionWithTool")
        .mockResolvedValue();

      await sessionRuntime.selectTerminalBackend("tmux");

      expect(switchSpy).toHaveBeenCalledWith("project-a", undefined, {
        forceToolPrompt: true,
      });
      expect(
        (
          sessionRuntime as unknown as {
            tmuxSessionsCreatedForStartup: Set<string>;
          }
        ).tmuxSessionsCreatedForStartup.has("project-a"),
      ).toBe(false);
    });

    it("starts with an existing valid stored zellij session", async () => {
      setConfiguration({ terminalBackend: "zellij" satisfies TerminalBackendType });
      upsertInstance({ zellijSessionId: "project-a", selectedAiTool: "codex" });
      vi.mocked(mockZellijSessionManager.discoverSessions).mockResolvedValue([
        {
          id: "project-a",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      ]);
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: () => Promise<AiToolConfig>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({ name: "codex", label: "Codex", path: "", args: [] });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "codex"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await sessionRuntime.startOpenCode();

      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "zellij attach 'project-a'",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
    });

    it("logs tmux setup failures during session switch and startup", async () => {
      vi.spyOn(mockLogger, "debug");
      vi.mocked(mockTmuxSessionManager.registerSessionHooks).mockRejectedValue(
        new Error("hook"),
      );
      vi.spyOn(
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        },
        "startExternalChangeMonitoring",
      ).mockRejectedValue(new Error("monitor"));
      const switchSpy = vi
        .spyOn(sessionRuntime, "switchToInstance")
        .mockResolvedValue();

      await sessionRuntime.switchToTmuxSession("tmux-session");

      expect(switchSpy).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Failed to register tmux session hooks"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start external change monitoring"),
      );
    });

    it("logs zellij switch and monitoring failures", async () => {
      vi.mocked(mockZellijSessionManager.switchSession).mockRejectedValueOnce(
        new Error("switch"),
      );
      vi.spyOn(
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        },
        "startExternalChangeMonitoring",
      ).mockRejectedValue(new Error("monitor"));
      vi.spyOn(sessionRuntime, "switchToInstance").mockResolvedValue();

      await sessionRuntime.switchToZellijSession("zellij-session");

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to switch zellij session"),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start zellij change monitoring"),
      );
    });

    it("posts terminalExited when attached tmux restoration fails", async () => {
      upsertInstance({ tmuxSessionId: "workspace-session" });
      (sessionRuntime as unknown as { isStarted: boolean }).isStarted = true;
      vi.spyOn(sessionRuntime, "switchToNativeShell").mockRejectedValue(
        new Error("native failed"),
      );
      registerDefaultSession({
        tmuxSessionId: "workspace-session",
        backend: "tmux",
      });

      sessionRuntime.reconnectListeners();
      exitHandler?.("default");
      await flushAsyncWork();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to restore after tmux exit"),
      );
      expect(postMessageMock).toHaveBeenCalledWith({ type: "terminalExited" });
    });

    it("resolves private backend fallbacks from selected session ids", async () => {
      (
        sessionRuntime as unknown as { selectedZellijSessionId?: string }
      ).selectedZellijSessionId = "selected-zellij";
      await sessionRuntime.killTmuxSession("selected-zellij");
      expect(mockZellijSessionManager.killSession).toHaveBeenCalledWith(
        "selected-zellij",
      );

      (
        sessionRuntime as unknown as { selectedTmuxSessionId?: string }
      ).selectedTmuxSessionId = "selected-tmux";
      await sessionRuntime.killTmuxSession("selected-tmux");
      expect(mockTmuxSessionManager.killSession).toHaveBeenCalledWith(
        "selected-tmux",
      );
    });

    it("covers no-manager private pane/session helpers", async () => {
      const runtimeWithoutManagers = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        undefined,
        undefined,
        backendRegistry,
        instanceStore,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      (
        runtimeWithoutManagers as unknown as { activeBackend: TerminalBackendType }
      ).activeBackend = "tmux";

      await (
        runtimeWithoutManagers as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();
      await expect(
        runtimeWithoutManagers.routeDroppedTextToTmuxPane("x", { col: 1, row: 1 }),
      ).resolves.toBe(false);
      await expect(
        runtimeWithoutManagers.killTmuxSession("tmux-session"),
      ).resolves.toBeUndefined();
      runtimeWithoutManagers.dispose();
    });

    it("covers no-manager zellij pane and kill helpers", async () => {
      const runtimeWithoutZellij = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        mockTmuxSessionManager,
        undefined,
        backendRegistry,
        instanceStore,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      (
        runtimeWithoutZellij as unknown as { activeBackend: TerminalBackendType }
      ).activeBackend = "zellij";

      await (
        runtimeWithoutZellij as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();
      await expect(
        runtimeWithoutZellij.killTmuxSession("zellij-session"),
      ).resolves.toBeUndefined();
      runtimeWithoutZellij.dispose();
    });

    it("routes tmux drops to false when geometry has no target", async () => {
      setActiveBackend("tmux");
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "attached",
        session: {
          id: "s",
          name: "s",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(mockTmuxSessionManager.listVisiblePaneGeometry).mockResolvedValue([
        { paneId: "%1", paneLeft: 0, paneTop: 0, paneWidth: 5, paneHeight: 5 },
      ] as unknown as Awaited<
        ReturnType<TmuxSessionManager["listVisiblePaneGeometry"]>
      >);

      await expect(
        sessionRuntime.routeDroppedTextToTmuxPane("hello", { col: 9, row: 9 }),
      ).resolves.toBe(false);
    });

    it("syncs active instance and handles subscription without an instance store", () => {
      upsertInstance({ id: "other" });
      (
        sessionRuntime as unknown as { syncActiveInstance: (id: string) => void }
      ).syncActiveInstance("other");
      expect(instanceStore.getActive().config.id).toBe("other");

      const runtimeWithoutStore = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        mockTmuxSessionManager,
        mockZellijSessionManager,
        backendRegistry,
        undefined,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      runtimeWithoutStore.subscribeToActiveInstanceChanges();
      (
        runtimeWithoutStore as unknown as { syncActiveInstance: (id: string) => void }
      ).syncActiveInstance("other");
      runtimeWithoutStore.dispose();
    });

    it("covers clipboard and monitoring early returns", async () => {
      (
        sessionRuntime as unknown as { startClipboardSync: () => void }
      ).startClipboardSync();
      await (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring("native-session");
      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();

      expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
    });

    it("returns early when auto-context was already sent", async () => {
      (sessionRuntime as unknown as { autoContextSent: boolean }).autoContextSent =
        true;
      await (
        sessionRuntime as unknown as { sendAutoContext: () => Promise<void> }
      ).sendAutoContext();
      expect(mockContextSharingService.getCurrentContext).not.toHaveBeenCalled();
    });

    it("covers remaining private defensive statements", async () => {
      await sessionRuntime.zoomTmuxPane();

      upsertInstance({ id: "mapped", tmuxSessionId: "mapped-tmux" });
      await sessionRuntime.killTmuxSession("mapped-tmux");
      expect(mockTmuxSessionManager.killSession).toHaveBeenCalledWith(
        "mapped-tmux",
      );

      const runtimeWithoutManagers = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        undefined,
        undefined,
        backendRegistry,
        instanceStore,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      await expect(
        (
          runtimeWithoutManagers as unknown as {
            findReplacementTmuxSession: (
              workspacePath: string,
              killedSessionId: string,
            ) => Promise<string | undefined>;
          }
        ).findReplacementTmuxSession("/workspace/project-a", "killed"),
      ).resolves.toBeUndefined();
      runtimeWithoutManagers.rememberSelectedTool("codex");
      runtimeWithoutManagers.dispose();

      vi.mocked(mockTmuxSessionManager.findSessionForWorkspace).mockRejectedValueOnce(
        new Error("find failed"),
      );
      await expect(
        (
          sessionRuntime as unknown as {
            findReplacementTmuxSession: (
              workspacePath: string,
              killedSessionId: string,
            ) => Promise<string | undefined>;
          }
        ).findReplacementTmuxSession("/workspace/project-a", "killed"),
      ).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to resolve replacement tmux session"),
      );

      vi.spyOn(instanceStore, "get").mockImplementationOnce(() => {
        throw new Error("terminal key failed");
      });
      expect(sessionRuntime.getActiveTerminalId()).toBe("default");
    });

    it("ticks zellij monitoring and records tmux SIGUSR2 checks", async () => {
      vi.useFakeTimers();
      setActiveBackend("zellij");
      vi.mocked(mockZellijSessionManager.listPanes).mockResolvedValue([
        { id: "p1", title: "shell", isFocused: true, isFloating: false },
      ]);
      vi.mocked(mockZellijSessionManager.listTabs).mockResolvedValue([
        { index: 1, name: "main", isActive: true },
      ]);
      await (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring("zellij-session");
      await vi.advanceTimersByTimeAsync(1500);

      setActiveBackend("tmux");
      (
        sessionRuntime as unknown as { selectedTmuxSessionId?: string }
      ).selectedTmuxSessionId = "tmux-session";
      (sessionRuntime as unknown as { sigusr2FiredSinceLastCheck: boolean }).sigusr2FiredSinceLastCheck = true;
      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValue([
        { paneId: "%1", isActive: true, currentCommand: undefined },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listPanes"]>>);
      vi.mocked(mockTmuxSessionManager.listWindows).mockResolvedValue([
        { windowId: "@1", isActive: true, index: 1, name: "main" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["listWindows"]>>);
      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();

      expect(
        (sessionRuntime as unknown as { sigusr2FiredSinceLastCheck: boolean })
          .sigusr2FiredSinceLastCheck,
      ).toBe(false);
      vi.useRealTimers();
    });

    it("logs zellij pane checking failures after an active session is known", async () => {
      setActiveBackend("zellij");
      (
        sessionRuntime as unknown as { selectedZellijSessionId?: string }
      ).selectedZellijSessionId = "zellij-session";
      vi.mocked(mockZellijSessionManager.listPanes).mockRejectedValueOnce(
        new Error("zellij panes"),
      );
      vi.mocked(mockZellijSessionManager.listTabs).mockResolvedValue([]);

      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to check zellij pane changes"),
      );
    });

    it("resolves stored tools and skips persistence without records", () => {
      setConfiguration({
        aiTools: [{ name: "codex", label: "Codex", path: "", args: [] }],
        defaultAiTool: "codex",
      });
      vi.mocked(mockAiToolRegistry.matchesName).mockImplementation(
        (tool, name) => tool.name === name,
      );
      expect(
        (
          sessionRuntime as unknown as {
            resolveStoredTool: (id?: string) => AiToolConfig | undefined;
          }
        ).resolveStoredTool("missing")?.name,
      ).toBe("codex");
      sessionRuntime.rememberSelectedTool("codex", "missing");
      expect(instanceStore.get("missing")).toBeUndefined();
    });

    it("covers remaining reachable fallback statements", async () => {
      vi.spyOn(mockLogger, "debug");
      setConfiguration({ terminalBackend: "tmux" satisfies TerminalBackendType });
      vscode.workspace.workspaceFolders = undefined;
      vi.mocked(mockTmuxSessionManager.discoverSessions).mockResolvedValue([]);
      await sessionRuntime.startOpenCode();
      expect(sessionRuntime.getActiveBackend()).toBe("native");

      sessionRuntime.resetState();
      vscode.workspace.workspaceFolders = [
        { uri: { fsPath: "/workspace/project-a" }, name: "project-a", index: 0 },
      ];
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "created",
        session: {
          id: "project-a",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      vi.mocked(
        mockTmuxSessionManager.configureMouseAndClipboard,
      ).mockRejectedValueOnce(
        new Error("mouse"),
      );
      vi.mocked(mockTmuxSessionManager.registerSessionHooks).mockRejectedValueOnce(
        new Error("hooks"),
      );
      vi.mocked(mockTmuxSessionManager.listPanes).mockRejectedValueOnce(
        new Error("monitor"),
      );
      await sessionRuntime.startOpenCode();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Failed to enable tmux mouse and clipboard integration"),
      );

      const runtimeWithoutZellij = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        mockTmuxSessionManager,
        undefined,
        backendRegistry,
        instanceStore,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      await expect(
        (
          runtimeWithoutZellij as unknown as {
            validateZellijSessionExists: (sessionId: string) => Promise<boolean>;
          }
        ).validateZellijSessionExists("missing"),
      ).resolves.toBe(false);
      runtimeWithoutZellij.dispose();

      upsertInstance({ id: "bad-workspace", workspaceUri: "bad://uri" });
      vi.mocked(vscode.Uri.parse).mockImplementationOnce(() => {
        throw new Error("bad uri");
      });
      expect(sessionRuntime.resolveInstanceIdFromSessionId("uri")).toBe(
        "bad-workspace",
      );

      instanceStore.setActive("default");
      (
        sessionRuntime as unknown as { syncActiveInstance: (id: string) => void }
      ).syncActiveInstance("bad-workspace");
      expect(instanceStore.getActive().config.id).toBe("bad-workspace");

      const runtimeWithoutStore = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        mockTmuxSessionManager,
        mockZellijSessionManager,
        backendRegistry,
        undefined,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      runtimeWithoutStore.rememberSelectedTool("codex");
      runtimeWithoutStore.dispose();
    });

    it("covers contradictory manager guard fallbacks with a forced pane manager", async () => {
      const forcedPaneManager = { marker: "present" };
      Object.defineProperty(sessionRuntime, "activePaneManager", {
        configurable: true,
        get: () => forcedPaneManager,
      });

      setActiveBackend("tmux");
      (
        sessionRuntime as unknown as { tmuxSessionManager?: TmuxSessionManager }
      ).tmuxSessionManager = undefined;
      await expect(sessionRuntime.zoomTmuxPane()).resolves.toBeUndefined();
      await expect(
        sessionRuntime.routeDroppedTextToTmuxPane("dropped", {
          col: 1,
          row: 1,
        }),
      ).resolves.toBe(false);
      await expect(
        (
          sessionRuntime as unknown as {
            startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
          }
        ).startExternalChangeMonitoring("forced-tmux"),
      ).resolves.toBeUndefined();
      await expect(
        (
          sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
        ).checkPaneChanges(),
      ).resolves.toBeUndefined();

      setActiveBackend("zellij");
      (
        sessionRuntime as unknown as {
          zellijSessionManager?: ZellijSessionManager;
        }
      ).zellijSessionManager = undefined;
      await expect(
        (
          sessionRuntime as unknown as {
            checkZellijPaneChanges: () => Promise<void>;
          }
        ).checkZellijPaneChanges(),
      ).resolves.toBeUndefined();
    });

    it("logs non-Error monitoring failures during tmux startup", async () => {
      vi.spyOn(mockLogger, "debug");
      setConfiguration({ terminalBackend: "tmux" satisfies TerminalBackendType });
      upsertInstance({ workspaceUri: "file:///workspace/project-a" });
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValue({
        action: "attached",
        session: {
          id: "project-a",
          name: "project-a",
          workspace: "/workspace/project-a",
          isActive: true,
        },
      });
      (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring = vi.fn(async () => {
        throw "monitor failed";
      });

      await sessionRuntime.startOpenCode();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to start external change monitoring: monitor failed",
        ),
      );
    });

    it("covers branch-only fallback paths on SessionRuntime helpers", async () => {
      vi.spyOn(mockLogger, "warn");
      vi.spyOn(mockLogger, "error");
      vi.spyOn(mockLogger, "debug");

      vi.mocked(mockTerminalManager.getByInstance).mockReturnValueOnce({
        id: "existing",
        pid: 123,
      } as never as ReturnType<TerminalManager["getByInstance"]>);
      await sessionRuntime.switchToInstance("existing");
      expect(mockTerminalManager.resizeTerminal).not.toHaveBeenCalledWith(
        "existing",
        0,
        0,
      );

      upsertInstance({ workspaceUri: "file:///" });
      vi.mocked(vscode.Uri.parse).mockReturnValueOnce({
        fsPath: "",
      } as never as vscodeApi.Uri);
      expect(sessionRuntime.resolveWorkspacePathFromActiveInstance()).toBeUndefined();

      vi.mocked(mockTmuxSessionManager.ensureSession).mockRejectedValueOnce(
        "ensure down",
      );
      await expect(sessionRuntime.ensureWorkspaceSession("/")).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("ensure down"),
      );

      vi.mocked(mockTmuxSessionManager.discoverSessions).mockResolvedValueOnce([
        { id: "first", name: "first", workspace: "/tmp", isActive: false },
      ]);
      await expect(sessionRuntime.resolveFallbackTmuxSessionId()).resolves.toBe(
        "first",
      );
      vi.mocked(mockTmuxSessionManager.discoverSessions).mockRejectedValueOnce(
        "fallback tmux down",
      );
      await expect(sessionRuntime.resolveFallbackTmuxSessionId()).resolves.toBeUndefined();

      vi.mocked(mockZellijSessionManager.discoverSessions).mockResolvedValueOnce([
        { id: "first-zellij", name: "first-zellij", workspace: "/tmp", isActive: false },
      ]);
      await expect(
        sessionRuntime.resolveFallbackZellijSessionId(),
      ).resolves.toBe("first-zellij");
      vi.mocked(mockZellijSessionManager.discoverSessions).mockRejectedValueOnce(
        "fallback zellij down",
      );
      await expect(
        sessionRuntime.resolveFallbackZellijSessionId(),
      ).resolves.toBeUndefined();

      vi.mocked(mockZellijSessionManager.ensureSession).mockRejectedValueOnce(
        "zellij ensure down",
      );
      await expect(
        sessionRuntime.ensureZellijWorkspaceSession("/"),
      ).resolves.toBeUndefined();

      vscode.workspace.workspaceFolders = [
        { uri: { fsPath: "/" }, name: "root", index: 0 },
      ];
      vi.mocked(mockTmuxSessionManager.discoverSessions).mockResolvedValueOnce([
        { id: "opencode", name: "opencode", workspace: "/", isActive: false },
      ]);
      vi.mocked(mockTmuxSessionManager.createSession).mockRejectedValueOnce(
        "create down",
      );
      await expect(sessionRuntime.createTmuxSession()).resolves.toBeUndefined();

      setActiveBackend("zellij");
      vi.mocked(mockZellijSessionManager.zoomPane).mockRejectedValueOnce(
        "zellij zoom down",
      );
      await sessionRuntime.zoomTmuxPane();

      setActiveBackend("tmux");
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValueOnce({
        action: "attached",
        session: { id: "zoom", name: "zoom", workspace: "/", isActive: true },
      });
      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValueOnce([
        { paneId: "%1", index: 0, title: "%1", isActive: false, currentCommand: "shell" },
      ]);
      vi.mocked(mockTmuxSessionManager.zoomPane).mockRejectedValueOnce(
        "tmux zoom down",
      );
      await sessionRuntime.zoomTmuxPane();
    });

    it("covers remaining startup, listener, and session-management branch slots", async () => {
      vi.spyOn(mockLogger, "debug");
      vi.spyOn(mockLogger, "warn");
      vi.spyOn(mockLogger, "error");

      vi.mocked(mockTerminalManager.onData).mockImplementationOnce((callback) => {
        callback({ id: "not-active", data: "ignored" });
        return { dispose: vi.fn() };
      });
      sessionRuntime.reconnectListeners();
      expect(postMessageMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: "ignored" }),
      );

      setConfiguration({ terminalBackend: "tmux" satisfies TerminalBackendType });
      (
        sessionRuntime as unknown as { selectedTmuxSessionId?: string }
      ).selectedTmuxSessionId = "explicit-tmux";
      vi.mocked(
        mockTmuxSessionManager.configureMouseAndClipboard,
      ).mockRejectedValueOnce(
        "mouse down",
      );
      vi.mocked(mockTmuxSessionManager.registerSessionHooks).mockRejectedValueOnce(
        "hooks down",
      );
      (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring = vi.fn(async () => {
        throw new Error("monitor error");
      });
      await sessionRuntime.startOpenCode();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("mouse down"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("hooks down"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("monitor error"),
      );
      sessionRuntime.resetState();

      (
        sessionRuntime as unknown as { selectedTmuxSessionId?: string }
      ).selectedTmuxSessionId = undefined;
      setConfiguration({ terminalBackend: "zellij" satisfies TerminalBackendType });
      vi.mocked(mockZellijSessionManager.discoverSessions).mockResolvedValueOnce([]);
      await sessionRuntime.startOpenCode();
      sessionRuntime.resetState();

      (
        sessionRuntime as unknown as { selectedZellijSessionId?: string }
      ).selectedZellijSessionId = "stale-zellij";
      vi.mocked(mockZellijSessionManager.discoverSessions).mockResolvedValueOnce([]);
      await sessionRuntime.startOpenCode();
      sessionRuntime.resetState();

      vi.mocked(mockPortManager.assignPortToTerminal).mockImplementationOnce(() => {
        throw "port down";
      });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "opencode"),
        supportsHttpApi: vi.fn(() => true),
      } as never);
      setConfiguration({
        terminalBackend: "native" satisfies TerminalBackendType,
        enableHttpApi: true,
        defaultAiTool: "opencode",
      });
      await sessionRuntime.startOpenCode();
      sessionRuntime.resetState();

      const runtimeWithoutManagers = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        undefined,
        undefined,
        backendRegistry,
        undefined,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      await runtimeWithoutManagers.switchToTmuxSessionWithTool("no-tmux");
      await runtimeWithoutManagers.switchToZellijSession("no-zellij");
      runtimeWithoutManagers.dispose();
    });

    it("covers kill, restore, monitoring, and auto-context branch slots", async () => {
      vi.spyOn(mockLogger, "warn");
      vi.spyOn(mockLogger, "error");
      upsertInstance({ id: "unrelated", workspaceUri: undefined, tmuxSessionId: "other" });
      setActiveBackend("tmux");
      await (
        sessionRuntime as unknown as {
          restoreAfterAttachedTmuxSessionExit: (sessionId: string) => Promise<void>;
        }
      ).restoreAfterAttachedTmuxSessionExit("exited-without-workspace");

      vi.mocked(mockTmuxSessionManager.killSession).mockRejectedValueOnce(
        "kill tmux down",
      );
      await sessionRuntime.killTmuxSession("other-tmux");
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("kill tmux down"),
      );

      setActiveBackend("zellij");
      vi.mocked(mockZellijSessionManager.killSession).mockRejectedValueOnce(
        "kill zellij down",
      );
      await sessionRuntime.killTmuxSession("zellij-to-kill");
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("kill zellij down"),
      );

      vi.mocked(mockZellijSessionManager.sendTextToPane).mockRejectedValueOnce(
        "drop zellij down",
      );
      await expect(
        sessionRuntime.routeDroppedTextToTmuxPane("drop", { col: 0, row: 0 }),
      ).resolves.toBe(false);

      setActiveBackend("tmux");
      vi.mocked(mockTmuxSessionManager.ensureSession).mockResolvedValueOnce({
        action: "attached",
        session: { id: "drop", name: "drop", workspace: "/", isActive: true },
      });
      vi.mocked(mockTmuxSessionManager.listVisiblePaneGeometry).mockRejectedValueOnce(
        "drop tmux down",
      );
      await expect(
        sessionRuntime.routeDroppedTextToTmuxPane("drop", { col: 0, row: 0 }),
      ).resolves.toBe(false);

      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValueOnce([
        { paneId: "%1", index: 0, title: "%1", isActive: false },
      ]);
      await (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring("monitor-no-command");

      vi.mocked(mockTmuxSessionManager.discoverSessions).mockRejectedValueOnce(
        "discover tmux down",
      );
      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();

      setActiveBackend("zellij");
      vi.mocked(mockZellijSessionManager.discoverSessions).mockRejectedValueOnce(
        "discover zellij down",
      );
      await (
        sessionRuntime as unknown as { checkZellijPaneChanges: () => Promise<void> }
      ).checkZellijPaneChanges();

      vi.mocked(mockZellijSessionManager.discoverSessions).mockResolvedValueOnce([
        { id: "zellij-active", name: "zellij-active", workspace: "/tmp", isActive: true },
      ]);
      vi.mocked(mockZellijSessionManager.listPanes).mockResolvedValueOnce([
        { id: "p1", title: "shell", isFocused: true, isFloating: false },
      ]);
      vi.mocked(mockZellijSessionManager.listTabs).mockResolvedValueOnce([]);
      await (
        sessionRuntime as unknown as { checkZellijPaneChanges: () => Promise<void> }
      ).checkZellijPaneChanges();

      (
        sessionRuntime as unknown as { activeTool?: AiToolConfig }
      ).activeTool = undefined;
      await (
        sessionRuntime as unknown as { sendAutoContext: () => Promise<void> }
      ).sendAutoContext();

      (
        sessionRuntime as unknown as { activeTool?: AiToolConfig }
      ).activeTool = { name: "codex", label: "Codex", path: "codex", args: [] };
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        supportsAutoContext: vi.fn(() => true),
        formatFileReference: vi.fn((reference) => reference.path),
      } as never);
      (
        sessionRuntime as unknown as { httpAvailable: boolean; apiClient: OpenCodeApiClient }
      ).httpAvailable = true;
      (
        sessionRuntime as unknown as { apiClient: { appendPrompt: (prompt: string) => Promise<void> } }
      ).apiClient = { appendPrompt: vi.fn(async () => { throw "context down"; }) };
      vi.mocked(mockContextSharingService.getCurrentContext).mockReturnValue({
        filePath: "src/file.ts",
        selectionStart: 1,
        selectionEnd: 1,
      });
      await (
        sessionRuntime as unknown as { sendAutoContext: () => Promise<void> }
      ).sendAutoContext();
    });

    it("covers final defensive branch variants", async () => {
      vi.spyOn(mockLogger, "debug");
      vi.spyOn(mockLogger, "warn");
      vi.spyOn(mockLogger, "error");

      upsertInstance({ id: "active-empty-fs", workspaceUri: "file:///empty" });
      instanceStore.setActive("active-empty-fs");
      vi.mocked(vscode.Uri.parse).mockReturnValueOnce({ fsPath: "" } as never as vscodeApi.Uri);
      expect(sessionRuntime.resolveWorkspacePathFromActiveInstance()).toBeUndefined();

      setConfiguration({ terminalBackend: "zellij" satisfies TerminalBackendType });
      upsertInstance({ zellijSessionId: "store-stale-zellij" });
      vi.mocked(mockZellijSessionManager.discoverSessions).mockResolvedValueOnce([]);
      await sessionRuntime.startOpenCode();
      sessionRuntime.resetState();

      vi.mocked(mockTerminalManager.onData).mockImplementationOnce((callback) => {
        callback({ id: "definitely-not-active", data: "ignored" });
        return { dispose: vi.fn() };
      });
      sessionRuntime.reconnectListeners();
      exitHandler?.("definitely-not-active");

      const runtimeWithoutStore = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        mockTmuxSessionManager,
        mockZellijSessionManager,
        backendRegistry,
        undefined,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
      );
      await (
        runtimeWithoutStore as unknown as {
          restoreAfterAttachedTmuxSessionExit: (sessionId: string) => Promise<void>;
        }
      ).restoreAfterAttachedTmuxSessionExit("no-store");
      await runtimeWithoutStore.killTmuxSession("no-store-tmux");
      (
        runtimeWithoutStore as unknown as { activeBackend: TerminalBackendType }
      ).activeBackend = "zellij";
      await runtimeWithoutStore.killTmuxSession("no-store-zellij");
      runtimeWithoutStore.dispose();

      upsertInstance({ id: "restore-no-workspace" });
      instanceStore.setActive("restore-no-workspace");
      vi.spyOn(sessionRuntime, "switchToNativeShell").mockRejectedValueOnce(
        new Error("restore error"),
      );
      await (
        sessionRuntime as unknown as {
          restoreAfterAttachedTmuxSessionExit: (sessionId: string) => Promise<void>;
        }
      ).restoreAfterAttachedTmuxSessionExit("restore-error");

      vi.mocked(mockTmuxSessionManager.registerSessionHooks).mockRejectedValueOnce(
        new Error("hook error"),
      );
      await sessionRuntime.switchToTmuxSession("tmux-errors");

      vi.mocked(mockZellijSessionManager.switchSession).mockRejectedValueOnce(
        new Error("switch error"),
      );
      await sessionRuntime.switchToZellijSession("zellij-errors");

      setActiveBackend("tmux");
      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValueOnce([
        { paneId: "%cmd", index: 0, title: "%cmd", isActive: true, currentCommand: undefined },
      ]);
      await (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring("current-command-fallback");

      vi.mocked(mockTmuxSessionManager.listPanes).mockRejectedValueOnce(
        "monitor init down",
      );
      await (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring("monitor-init-string");

      setActiveBackend("zellij");
      (
        sessionRuntime as unknown as { paneMonitorInterval?: ReturnType<typeof setInterval> }
      ).paneMonitorInterval = setInterval(() => undefined, 10);
      await (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring("zellij-existing-interval");

      setActiveBackend("tmux");
      (
        sessionRuntime as unknown as { selectedTmuxSessionId?: string; knownActiveWindowId?: string; _lastCanKillPane?: boolean }
      ).selectedTmuxSessionId = "pane-check";
      (
        sessionRuntime as unknown as { knownActiveWindowId?: string; _lastCanKillPane?: boolean }
      ).knownActiveWindowId = "w1";
      (
        sessionRuntime as unknown as { _lastCanKillPane?: boolean }
      )._lastCanKillPane = false;
      vi.mocked(mockTmuxSessionManager.listPanes).mockResolvedValueOnce([
        { paneId: "%1", index: 0, title: "%1", isActive: true, currentCommand: "shell" },
      ]);
      vi.mocked(mockTmuxSessionManager.listWindows).mockResolvedValueOnce([
        { windowId: "w1", index: 0, name: "one", isActive: true },
        { windowId: "w2", index: 1, name: "two", isActive: false },
      ]);
      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();
      vi.mocked(mockTmuxSessionManager.listPanes).mockRejectedValueOnce(
        new Error("check error"),
      );
      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();

      setActiveBackend("zellij");
      vi.mocked(mockZellijSessionManager.discoverSessions).mockResolvedValueOnce([
        { id: "zellij-check", name: "zellij-check", workspace: "/tmp", isActive: true },
      ]);
      vi.mocked(mockZellijSessionManager.listPanes).mockRejectedValueOnce(
        "zellij check down",
      );
      await (
        sessionRuntime as unknown as { checkZellijPaneChanges: () => Promise<void> }
      ).checkZellijPaneChanges();
    });

    it("covers remaining false-side startup and workspace parsing branches", async () => {
      vi.spyOn(mockLogger, "warn");
      upsertInstance({ id: "active-no-fs", workspaceUri: "file:///no-fs" });
      instanceStore.setActive("active-no-fs");
      (
        sessionRuntime as unknown as { activeInstanceId: string }
      ).activeInstanceId = "active-no-fs";
      vi.mocked(vscode.Uri.parse).mockReturnValueOnce(
        {} as unknown as vscodeApi.Uri,
      );
      expect(
        sessionRuntime.resolveWorkspacePathFromActiveInstance(),
      ).toBeUndefined();

      sessionRuntime.resetState();
      (
        sessionRuntime as unknown as { forceNativeShellNextStart: boolean }
      ).forceNativeShellNextStart = true;
      (
        sessionRuntime as unknown as {
          pendingLaunchToolName?: string;
          selectedTmuxSessionId?: string;
        }
      ).pendingLaunchToolName = "ignored-tool";
      (
        sessionRuntime as unknown as {
          pendingLaunchToolName?: string;
          selectedTmuxSessionId?: string;
        }
      ).selectedTmuxSessionId = "ignored-tmux";
      const resolveToolSpy = vi.spyOn(
        sessionRuntime as unknown as {
          resolveToolForStartup: (config: unknown) => Promise<AiToolConfig | undefined>;
        },
        "resolveToolForStartup",
      );
      const upsertSpy = vi
        .spyOn(instanceStore, "upsert")
        .mockImplementationOnce(() => {
          throw "upsert string";
        });

      await sessionRuntime.startOpenCode();

      expect(resolveToolSpy).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("upsert string"),
      );
      upsertSpy.mockRestore();
    });

    it("covers tmux restore and kill fallbacks without workspace paths", async () => {
      vi.spyOn(mockLogger, "error");
      vi.spyOn(mockLogger, "warn");
      upsertInstance({ id: "other-tmux", tmuxSessionId: "not-kill-me" });
      upsertInstance({ id: "active-tmux", tmuxSessionId: "kill-me" });
      instanceStore.setActive("active-tmux");
      setActiveBackend("tmux");
      (
        sessionRuntime as unknown as { activeInstanceId: string; isStarted: boolean }
      ).activeInstanceId = "active-tmux";
      (
        sessionRuntime as unknown as { activeInstanceId: string; isStarted: boolean }
      ).isStarted = true;
      vi.spyOn(
        sessionRuntime as unknown as {
          resolveWorkspacePathForTmuxFallback: () => string | undefined;
        },
        "resolveWorkspacePathForTmuxFallback",
      ).mockReturnValue(undefined);
      const findReplacementSpy = vi.spyOn(
        sessionRuntime as unknown as {
          findReplacementTmuxSession: (
            workspacePath: string,
            killedSessionId: string,
          ) => Promise<string | undefined>;
        },
        "findReplacementTmuxSession",
      );
      const nativeSpy = vi
        .spyOn(sessionRuntime, "switchToNativeShell")
        .mockResolvedValue(undefined);

      await sessionRuntime.killTmuxSession("kill-me");

      expect(mockPortManager.releaseTerminalPorts).toHaveBeenCalledWith(
        "active-tmux",
      );
      expect(instanceStore.get("active-tmux")?.runtime.tmuxSessionId).toBeUndefined();
      expect(findReplacementSpy).not.toHaveBeenCalled();
      expect(nativeSpy).toHaveBeenCalled();

      nativeSpy.mockRejectedValueOnce("restore string");
      await (
        sessionRuntime as unknown as {
          restoreAfterAttachedTmuxSessionExit: (sessionId: string) => Promise<void>;
        }
      ).restoreAfterAttachedTmuxSessionExit("restore-string");
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("restore string"),
      );
    });

    it("logs non-Error tmux and zellij switch monitoring failures", async () => {
      vi.spyOn(mockLogger, "debug");
      vi.spyOn(mockLogger, "warn");
      vi.mocked(mockTmuxSessionManager.registerSessionHooks).mockRejectedValueOnce(
        "hook string",
      );
      vi.spyOn(
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        },
        "startExternalChangeMonitoring",
      ).mockRejectedValueOnce(42);

      await sessionRuntime.switchToTmuxSessionWithTool("tmux-string-errors");

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("hook string"),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("42"),
      );

      vi.mocked(mockZellijSessionManager.switchSession).mockRejectedValueOnce(42);
      vi.spyOn(
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        },
        "startExternalChangeMonitoring",
      ).mockRejectedValueOnce("zellij monitor string");

      await sessionRuntime.switchToZellijSession("zellij-string-errors");

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("42"),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("zellij monitor string"),
      );
    });

    it("logs non-Error replacement and pane monitoring failures", async () => {
      vi.spyOn(mockLogger, "warn");
      vi.mocked(mockTmuxSessionManager.findSessionForWorkspace).mockRejectedValueOnce(
        "find string",
      );
      await expect(
        (
          sessionRuntime as unknown as {
            findReplacementTmuxSession: (
              workspacePath: string,
              killedSessionId: string,
            ) => Promise<string | undefined>;
          }
        ).findReplacementTmuxSession("/workspace/project-a", "killed"),
      ).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("find string"),
      );

      setActiveBackend("tmux");
      (
        sessionRuntime as unknown as { selectedTmuxSessionId?: string }
      ).selectedTmuxSessionId = "pane-string";
      vi.mocked(mockTmuxSessionManager.listPanes).mockRejectedValueOnce(
        "pane string",
      );
      await (
        sessionRuntime as unknown as { checkPaneChanges: () => Promise<void> }
      ).checkPaneChanges();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("pane string"),
      );

      (
        sessionRuntime as unknown as {
          externalChangeListener?: { dispose: () => void };
        }
      ).externalChangeListener = { dispose: vi.fn() };
      await (
        sessionRuntime as unknown as {
          startExternalChangeMonitoring: (sessionId: string) => Promise<void>;
        }
      ).startExternalChangeMonitoring("existing-listener");
    });

    it("resolves a pending startup tool when no backend session is attached", async () => {
      const syntheticBackend = "synthetic" as unknown as TerminalBackendType;
      const runtimeWithPendingToolOnly = new SessionRuntime(
        mockTerminalManager,
        {} as OutputCaptureManager,
        undefined as unknown as OpenCodeApiClient,
        mockPortManager,
        mockTmuxSessionManager,
        mockZellijSessionManager,
        {
          resolveAvailable: vi.fn(() => syntheticBackend),
        } as unknown as TerminalBackendRegistry,
        instanceStore,
        mockLogger,
        mockContextSharingService,
        mockAiToolRegistry,
        mockCallbacks,
        mockNativeTerminalManager,
      );
      (
        runtimeWithPendingToolOnly as unknown as { pendingLaunchToolName?: string }
      ).pendingLaunchToolName = "pending-tool";
      vi.spyOn(
        runtimeWithPendingToolOnly as unknown as {
          resolveToolForStartup: (config: unknown) => Promise<AiToolConfig | undefined>;
        },
        "resolveToolForStartup",
      ).mockResolvedValue({
        name: "pending-tool",
        label: "Pending Tool",
        path: "",
        args: [],
      });
      vi.mocked(mockAiToolRegistry.getForConfig).mockReturnValue({
        getLaunchCommand: vi.fn(() => "run-pending-tool"),
        supportsHttpApi: vi.fn(() => false),
      } as never);

      await runtimeWithPendingToolOnly.startOpenCode();

      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "default",
        "run-pending-tool",
        {},
        undefined,
        undefined,
        undefined,
        "default",
        "/workspace/project-a",
      );
      runtimeWithPendingToolOnly.dispose();
    });

    // The remaining uncovered SessionRuntime branches are defensive contradictions
    // that cannot be reached through the public/private method contracts without
    // mutating production code: after activePaneManager is truthy for tmux/zellij,
    // the corresponding manager null checks at lines 1142, 1259, 1565, 1619, and
    // 1690 are false by construction. Several V8 branch slots also correspond to
    // optional chaining / nullish coalescing sub-branches inside these same guards.
  describe("multi-pane session management", () => {
    it("startPaneSession with native backend creates PTY session", async () => {
      const session = await sessionRuntime.startPaneSession("pane-1", "native", {
        paneId: "pane-1",
        command: "ls",
      });

      expect(session).toBeDefined();
      expect(session?.backend).toBe("native");
      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "pane-1",
        "ls",
        expect.any(Object),
        undefined,
        undefined,
        undefined,
        "default::pane-1",
        "/workspace/project-a",
      );
    });

    it("startPaneSession with tmux backend creates terminal with tmux attach command", async () => {
      const session = await sessionRuntime.startPaneSession("pane-1", "tmux", {
        paneId: "pane-1",
        backendConfig: { tmux: { sessionId: "session-1" } },
      });

      expect(session).toBeDefined();
      expect(session?.backend).toBe("tmux");
      expect(session?.tmuxSessionId).toBe("session-1");
      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "pane-1",
        "tmux attach-session -t session-1 \\; set-option -u status off",
        {},
        undefined,
        undefined,
        undefined,
        "default::pane-1",
        "/workspace/project-a",
      );
    });

    it("switchPaneBackend cleans up old session and creates new one", async () => {
      await sessionRuntime.startPaneSession("pane-1", "tmux", {
        paneId: "pane-1",
        backendConfig: { tmux: { sessionId: "session-1" } },
      });
      vi.mocked(mockTerminalManager.createTerminal).mockClear();

      const newSession = await sessionRuntime.switchPaneBackend("pane-1", "native");

      expect(mockTerminalManager.killTerminal).toHaveBeenCalledWith("pane-1");
      expect(newSession).toBeDefined();
      expect(newSession?.backend).toBe("native");
    });

    it("switchPaneBackend throws for nonexistent pane", async () => {
      await expect(
        sessionRuntime.switchPaneBackend("nonexistent", "native"),
      ).rejects.toThrow("switchPaneBackend: no session for pane nonexistent");
    });

    it("createSession with tmux backend does not throw", async () => {
      await expect(
        sessionRuntime.createSession("pane-1", {
          paneId: "pane-1",
          backend: "tmux",
          backendConfig: { tmux: { sessionId: "session-1" } },
        }),
      ).resolves.toBeDefined();
    });

    it("createSession with tmux backend creates a fresh session when no session id is provided", async () => {
      vi.mocked(mockTmuxSessionManager.discoverSessions).mockResolvedValue([
        { id: "project-a-ulw-editor-1", name: "project-a-ulw-editor-1" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["discoverSessions"]>>);

      const session = await sessionRuntime.createSession("ulw-editor-1", {
        paneId: "ulw-editor-1",
        backend: "tmux",
      });

      expect(mockTmuxSessionManager.createSession).toHaveBeenCalledWith(
        "project-a-ulw-editor-1-2",
        "/workspace/project-a",
      );
      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "ulw-editor-1",
        "tmux attach-session -t project-a-ulw-editor-1-2 \\; set-option -u status off",
        {},
        undefined,
        undefined,
        undefined,
        "default::ulw-editor-1",
        "/workspace/project-a",
      );
      expect(session?.tmuxSessionId).toBe("project-a-ulw-editor-1-2");
    });

    it("createSession with tmux backend creates a grouped editor session and new window when session id is provided", async () => {
      vi.mocked(mockTmuxSessionManager.discoverSessions).mockResolvedValue([
        { id: "shared-session", name: "shared-session" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["discoverSessions"]>>);
      vi.mocked(mockTmuxSessionManager.createWindow).mockResolvedValue({
        windowId: "@12",
        paneId: "%34",
      });

      const session = await sessionRuntime.createSession("ulw-editor-1", {
        paneId: "ulw-editor-1",
        backend: "tmux",
        backendConfig: { tmux: { sessionId: "shared-session" } },
      });

      expect(mockTmuxSessionManager.createGroupedSession).toHaveBeenCalledWith(
        "shared-session",
        "shared-session-ulw-editor-1",
        "/workspace/project-a",
      );
      expect(mockTmuxSessionManager.createWindow).toHaveBeenCalledWith(
        "shared-session-ulw-editor-1",
        "/workspace/project-a",
      );
      expect(mockTerminalManager.createTerminal).toHaveBeenCalledWith(
        "ulw-editor-1",
        "tmux attach-session -t shared-session-ulw-editor-1 \\; set-option -u status off",
        {},
        undefined,
        undefined,
        undefined,
        "default::ulw-editor-1",
        "/workspace/project-a",
      );
      expect(session).toEqual(
        expect.objectContaining({
          tmuxSessionId: "shared-session",
          tmuxAttachSessionId: "shared-session-ulw-editor-1",
          ownedTmuxSessionId: "shared-session-ulw-editor-1",
          tmuxWindowId: "@12",
          tmuxPaneId: "%34",
        }),
      );
    });

    it("destroySession kills owned grouped tmux editor sessions without killing the base session", async () => {
      vi.mocked(mockTmuxSessionManager.discoverSessions).mockResolvedValue([
        { id: "shared-session", name: "shared-session" },
      ] as unknown as Awaited<ReturnType<TmuxSessionManager["discoverSessions"]>>);
      vi.mocked(mockTmuxSessionManager.createWindow).mockResolvedValue({
        windowId: "@12",
        paneId: "%34",
      });

      await sessionRuntime.createSession("ulw-editor-1", {
        paneId: "ulw-editor-1",
        backend: "tmux",
        backendConfig: { tmux: { sessionId: "shared-session" } },
      });
      sessionRuntime.destroySession("ulw-editor-1");
      await Promise.resolve();

      expect(mockTmuxSessionManager.killSession).toHaveBeenCalledWith(
        "shared-session-ulw-editor-1",
      );
      expect(mockTmuxSessionManager.killSession).not.toHaveBeenCalledWith(
        "shared-session",
      );
    });
  });
});
});
