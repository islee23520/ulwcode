import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as os from "os";
import type * as vscodeApi from "vscode";
import type * as nodePtyTypes from "../test/mocks/node-pty";
import type * as vscodeTypes from "../test/mocks/vscode";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { InstanceStore } from "../services/InstanceStore";
import { OutputChannelService } from "../services/OutputChannelService";
import { TmuxSessionManager } from "../services/TmuxSessionManager";
import { PortManager } from "../services/PortManager";
import { TerminalManager } from "../terminals/TerminalManager";
import { TerminalProvider } from "./TerminalProvider";
import { DEFAULT_AI_TOOLS } from "../types";

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
    promises: {
      writeFile: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    },
  },
  readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
  promises: {
    writeFile: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
  },
}));

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);
await vi.importActual<typeof nodePtyTypes>("../test/mocks/node-pty");

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

vi.mock("node-pty", async () => {
  const actual = await vi.importActual("../test/mocks/node-pty");
  return actual;
});

describe("TerminalProvider", () => {
  let terminalManager: TerminalManager;
  let captureManager: OutputCaptureManager;
  let provider: TerminalProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    OutputChannelService.resetInstance();
    PortManager.resetInstance();
    terminalManager = new TerminalManager();
    captureManager = new OutputCaptureManager();
    vscode.workspace.workspaceFolders = undefined;
  });

  afterEach(() => {
    provider?.dispose();
    terminalManager.dispose();
    OutputChannelService.resetInstance();
    PortManager.resetInstance();
  });

  function mockConfiguration(options?: {
    autoStartOnOpen?: boolean;
    enableHttpApi?: boolean;
    defaultAiTool?: string;
    aiTools?: readonly unknown[];
    collapseSecondaryBarOnEditorOpen?: boolean;
    terminalDefaultLocation?: string;
  }) {
    const {
      autoStartOnOpen = false,
      enableHttpApi = false,
      defaultAiTool = "opencode",
      aiTools = DEFAULT_AI_TOOLS,
      collapseSecondaryBarOnEditorOpen = false,
      terminalDefaultLocation = "editor",
    } = options ?? {};

    const configuration = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "autoStartOnOpen") {
          return autoStartOnOpen;
        }
        if (key === "enableHttpApi") {
          return enableHttpApi;
        }
        if (key === "defaultAiTool") {
          return defaultAiTool;
        }
        if (key === "aiTools") {
          return aiTools;
        }
        if (key === "httpTimeout") {
          return 5000;
        }
        if (key === "logLevel") {
          return "error";
        }
        if (key === "collapseSecondaryBarOnEditorOpen") {
          return collapseSecondaryBarOnEditorOpen;
        }
        if (key === "terminal.defaultLocation") {
          return terminalDefaultLocation;
        }
        return defaultValue;
      }),
      update: vi.fn(),
    };

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
      configuration as any,
    );

    return configuration;
  }

  function createProvider(options?: {
    instanceStore?: InstanceStore;
    tmuxSessionManager?: TmuxSessionManager;
    zellijSessionManager?: any;
    tmuxPaneSyncService?: any;
    zellijPaneSyncService?: any;
  }): TerminalProvider {
    const context = new vscode.ExtensionContext();
    const portManager = PortManager.getInstance(options?.instanceStore);
    return new TerminalProvider(
      context as any,
      terminalManager,
      captureManager,
      portManager,
      options?.instanceStore,
      options?.tmuxSessionManager,
      options?.zellijSessionManager,
      undefined, // backendRegistry
      undefined, // nativeTerminalManager
      options?.tmuxPaneSyncService,
      options?.zellijPaneSyncService,
    );
  }

  function resolveProvider(target: TerminalProvider) {
    const view = vscode.WebviewView() as any;
    target.resolveWebviewView(view, {} as any, {} as any);
    const messageHandler = vi.mocked(view.webview.onDidReceiveMessage).mock
      .calls[0]?.[0] as (message: any) => void;

    return { view, messageHandler };
  }

  async function flushAsyncStartup(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  it("routes switchSession messages through tmux session switching", () => {
    mockConfiguration();
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-b-instance",
        workspaceUri: "file:///workspaces/workspace-b",
      },
      runtime: { terminalKey: "workspace-b-instance", tmuxSessionId: "tmux-b" },
      state: "connected",
    });

    provider = createProvider({ instanceStore });
    const { messageHandler } = resolveProvider(provider);
    const switchSpy = vi
      .spyOn(provider, "switchToTmuxSession")
      .mockResolvedValue(undefined);

    messageHandler({ type: "switchSession", sessionId: "tmux-b" });

    expect(switchSpy).toHaveBeenCalledWith("tmux-b");
  });

  it("routes kill/create session messages to provider handlers", () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);
    const killSpy = vi
      .spyOn(provider, "killTmuxSession")
      .mockResolvedValue(undefined);
    const createSpy = vi
      .spyOn(provider, "createTmuxSession")
      .mockResolvedValue(undefined);

    messageHandler({ type: "killSession", sessionId: "tmux-k" });
    messageHandler({ type: "createTmuxSession" });

    expect(killSpy).toHaveBeenCalledWith("tmux-k");
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("routes launchAiTool messages through the provider launch path", async () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);
    const launchSpy = vi.spyOn(provider, "launchAiTool").mockResolvedValue();

    messageHandler({
      type: "launchAiTool",
      sessionId: "tmux-a",
      tool: "codex",
      savePreference: true,
    });
    await Promise.resolve();

    expect(launchSpy).toHaveBeenCalledWith("tmux-a", "codex", true, undefined);
  });

  describe("native restore", () => {
    it("restores a disconnected native instance with its selectedAiTool", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      const instanceStore = new InstanceStore();
      instanceStore.upsert({
        config: {
          id: "native-disconnected",
          selectedAiTool: "codex",
          terminalBackend: "native",
        },
        runtime: { terminalKey: "native-disconnected" },
        state: "disconnected",
      });

      provider = createProvider({ instanceStore });
      const startSpy = vi
        .spyOn(provider["sessionRuntime"], "startOpenCode")
        .mockResolvedValue(undefined);

      resolveProvider(provider);
      await flushAsyncStartup();

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(
        instanceStore.get("native-disconnected")?.config.selectedAiTool,
      ).toBe("codex");
    });

    it("does not restore a connected native instance", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      const instanceStore = new InstanceStore();
      instanceStore.upsert({
        config: {
          id: "native-connected",
          selectedAiTool: "codex",
          terminalBackend: "native",
        },
        runtime: { terminalKey: "native-connected" },
        state: "connected",
      });

      provider = createProvider({ instanceStore });

      resolveProvider(provider);
      await flushAsyncStartup();

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it("does not restore a disconnected tmux instance", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      const instanceStore = new InstanceStore();
      instanceStore.upsert({
        config: {
          id: "tmux-disconnected",
          selectedAiTool: "codex",
          terminalBackend: "tmux",
        },
        runtime: {
          terminalKey: "tmux-disconnected",
          tmuxSessionId: "tmux-disconnected",
        },
        state: "disconnected",
      });

      provider = createProvider({ instanceStore });

      resolveProvider(provider);
      await flushAsyncStartup();

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it("does not restore without selectedAiTool", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      const instanceStore = new InstanceStore();
      instanceStore.upsert({
        config: {
          id: "native-first-run",
          terminalBackend: "native",
        },
        runtime: { terminalKey: "native-first-run" },
        state: "disconnected",
      });

      provider = createProvider({ instanceStore });

      resolveProvider(provider);
      await flushAsyncStartup();

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it("restores a disconnected native instance that already has backendState", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      const instanceStore = new InstanceStore();
      instanceStore.upsert({
        config: {
          id: "native-with-state",
          selectedAiTool: "codex",
          terminalBackend: "native",
        },
        runtime: {
          terminalKey: "native-with-state",
          terminalBackend: "native",
          backendState: {
            version: 1,
            backend: "native",
            restoreMode: "recreate",
            launchSpec: {
              command: "codex",
              cwd: "/workspace/project",
              name: "native-with-state",
            },
            createdAt: 1000,
          },
        },
        state: "disconnected",
      });

      provider = createProvider({ instanceStore });
      const startSpy = vi
        .spyOn(provider["sessionRuntime"], "startOpenCode")
        .mockResolvedValue(undefined);
      resolveProvider(provider);
      await flushAsyncStartup();

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(instanceStore.get("native-with-state")?.runtime.backendState).toEqual(
        expect.objectContaining({
          backend: "native",
          launchSpec: expect.objectContaining({ command: "codex" }),
        }),
      );
    });

    it("selected AI tool no longer in config restores without prompting", async () => {
      mockConfiguration({
        autoStartOnOpen: false,
        enableHttpApi: false,
        aiTools: [
          {
            name: "codex",
            label: "Codex",
            path: "",
            args: [],
          },
        ],
      });

      const instanceStore = new InstanceStore();
      instanceStore.upsert({
        config: {
          id: "native-missing-tool",
          selectedAiTool: "nonexistent-tool",
          terminalBackend: "native",
        },
        runtime: { terminalKey: "native-missing-tool" },
        state: "disconnected",
      });

      provider = createProvider({ instanceStore });
      const startSpy = vi
        .spyOn(provider["sessionRuntime"], "startOpenCode")
        .mockResolvedValue(undefined);
      resolveProvider(provider);
      await flushAsyncStartup();

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it("multiple disconnected instances only restores the active one", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });

      const instanceStore = new InstanceStore();
      instanceStore.upsert({
        config: {
          id: "native-inactive",
          selectedAiTool: "claude",
          terminalBackend: "native",
        },
        runtime: { terminalKey: "native-inactive" },
        state: "disconnected",
      });
      instanceStore.upsert({
        config: {
          id: "native-active",
          selectedAiTool: "codex",
          terminalBackend: "native",
        },
        runtime: { terminalKey: "native-active" },
        state: "disconnected",
      });
      instanceStore.setActive("native-active");

      provider = createProvider({ instanceStore });
      const startSpy = vi
        .spyOn(provider["sessionRuntime"], "startOpenCode")
        .mockResolvedValue(undefined);

      resolveProvider(provider);
      await flushAsyncStartup();

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(instanceStore.get("native-active")?.config.selectedAiTool).toBe(
        "codex",
      );
    });

    it("empty instance store does not trigger Quick Pick", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });

      provider = createProvider({ instanceStore: new InstanceStore() });

      resolveProvider(provider);
      await flushAsyncStartup();

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it("disconnected native without terminalBackend does not trigger Quick Pick", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });

      const instanceStore = new InstanceStore();
      instanceStore.upsert({
        config: {
          id: "native-no-backend",
          selectedAiTool: "codex",
        },
        runtime: { terminalKey: "native-no-backend" },
        state: "disconnected",
      });

      provider = createProvider({ instanceStore });

      resolveProvider(provider);
      await flushAsyncStartup();

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    });
  });

  it("routes zoomTmuxPane messages through the provider zoom path", async () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);
    const zoomSpy = vi.spyOn(provider, "zoomTmuxPane").mockResolvedValue();

    messageHandler({ type: "zoomTmuxPane" });
    await Promise.resolve();

    expect(zoomSpy).toHaveBeenCalledTimes(1);
  });

  it("routes executeTmuxRawCommand messages through the provider raw tmux path", async () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);
    const rawSpy = vi
      .spyOn(provider, "executeRawTmuxCommand")
      .mockResolvedValue("");

    messageHandler({
      type: "executeTmuxRawCommand",
      subcommand: "choose-tree",
    });
    await Promise.resolve();

    expect(rawSpy).toHaveBeenCalledWith("choose-tree", undefined);
  });

  it("opens the terminal renderer in an editor tab", async () => {
    mockConfiguration();
    provider = createProvider();
    resolveProvider(provider);

    await provider.openInEditorTab();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      "ulw.terminalEditor",
      "ULW Terminal",
      vscode.ViewColumn.Beside,
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: expect.any(Array),
      }),
    );

    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as any;
    expect(panel.webview.options).toEqual(
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: expect.any(Array),
      }),
    );
    provider.focus();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      paneId: "ulw-editor-1",
      type: "focusTerminal",
    });
  });

  it("starts at the configured editor location and starts the runtime", async () => {
    mockConfiguration({ terminalDefaultLocation: "editor" });
    provider = createProvider();
    resolveProvider(provider);
    const startSpy = vi
      .spyOn(provider["sessionRuntime"], "startOpenCode")
      .mockResolvedValue(undefined);

    await provider.startAtConfiguredLocation();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("starts at the configured sidebar location without opening an editor panel", async () => {
    mockConfiguration({ terminalDefaultLocation: "sidebar" });
    provider = createProvider();
    resolveProvider(provider);
    const startSpy = vi
      .spyOn(provider["sessionRuntime"], "startOpenCode")
      .mockResolvedValue(undefined);

    await provider.startAtConfiguredLocation();

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("reuses an existing editor panel when focusing the configured editor location", async () => {
    mockConfiguration({ terminalDefaultLocation: "editor" });
    provider = createProvider();
    resolveProvider(provider);
    await provider.openInEditorTab();
    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as any;

    await provider.focusAtConfiguredLocation();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.Active);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      paneId: "ulw-editor-1",
      type: "focusTerminal",
    });
  });

  it("falls back to the editor location for invalid terminal.defaultLocation values", async () => {
    mockConfiguration({ terminalDefaultLocation: "floating" });
    provider = createProvider();
    resolveProvider(provider);

    await provider.focusAtConfiguredLocation();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "workbench.view.focus",
      "ulw",
    );
  });

  it("reinitializes a restored editor panel during deserialization", async () => {
    mockConfiguration();
    provider = createProvider();
    resolveProvider(provider);

    const restoredPanel = (vscode.window.createWebviewPanel as any)();
    restoredPanel.webview.cspSource = "default-src 'none'";

    await provider.deserializeWebviewPanel(restoredPanel, undefined);

    expect(restoredPanel.webview.html).toContain("default-src 'none'");
    expect(restoredPanel.webview.onDidReceiveMessage).toHaveBeenCalledTimes(1);
  });

  it("injects multi-pane stylesheet links and bootstrap markers into the webview HTML", () => {
    mockConfiguration();
    provider = createProvider();

    const { view } = resolveProvider(provider);

    expect(view.webview.html).toContain("layout-engine.css");
    expect(view.webview.html).toContain("tab-bar.css");
    expect(view.webview.html).toContain("pane-actions.css");
    expect(view.webview.html).toContain("focus-manager.css");
    expect(view.webview.html).toContain("terminal-layout-root");
    expect(view.webview.html).toContain("__OPENCODE_TUI_MULTI_PANE__");
  });

  it("toggles from the sidebar into the editor panel", async () => {
    mockConfiguration();
    provider = createProvider();
    resolveProvider(provider);

    await provider.toggleEditorAttachment();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("toggles from the editor panel back to the sidebar", async () => {
    mockConfiguration();
    provider = createProvider();
    const { view } = resolveProvider(provider);

    await provider.openInEditorTab();
    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as any;
    const disposeListener = vi.mocked(panel.onDidDispose).mock.calls[0]?.[0] as
      | (() => void)
      | undefined;

    await provider.toggleEditorAttachment();
    disposeListener?.();

    expect(panel.dispose).toHaveBeenCalledTimes(1);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.view.extension.ulwContainer",
    );
    expect(view.show).toHaveBeenCalledWith(true);
  });

  it("starts the default AI tool directly for non-tmux sessions", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 120, rows: 40 });
    await flushAsyncStartup();

    expect(createTerminalSpy).toHaveBeenCalledWith(
      "opencode-main",
      "opencode -c",
      {},
      undefined,
      120,
      40,
      "opencode-main",
      os.homedir(),
    );
  });

  it("creates native pane sessions and tracks pane state for paneCreate messages", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const runtime = provider["sessionRuntime"];
    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("native");
    const createSessionSpy = vi
      .spyOn(runtime, "createSession")
      .mockResolvedValue(undefined);
    const { messageHandler } = resolveProvider(provider);

    messageHandler({
      type: "paneCreate",
      paneId: "pane-2",
      direction: "vertical",
    });
    await flushAsyncStartup();

    expect(createSessionSpy).toHaveBeenCalledWith("pane-2", {
      paneId: "pane-2",
      backend: "native",
    });
    expect(provider["paneStore"].getPane("pane-2")).toEqual(
      expect.objectContaining({
        paneId: "pane-2",
        tabId: "default",
        isActive: true,
        splitDirection: "vertical",
      }),
    );
  });

  it("destroys pane sessions, removes pane state, and refocuses the default pane on paneDelete", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const runtime = provider["sessionRuntime"];
    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("native");
    vi.spyOn(runtime, "createSession").mockResolvedValue(undefined);
    const destroySessionSpy = vi
      .spyOn(runtime, "destroySession")
      .mockImplementation(() => {});
    const { messageHandler, view } = resolveProvider(provider);

    messageHandler({ type: "paneCreate", paneId: "pane-delete" });
    await flushAsyncStartup();
    vi.mocked(view.webview.postMessage).mockClear();

    messageHandler({ type: "paneDelete", paneId: "pane-delete" });

    expect(destroySessionSpy).toHaveBeenCalledWith("pane-delete");
    expect(provider["paneStore"].getPane("pane-delete")).toBeUndefined();
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "focusTerminal",
      paneId: "default",
    });
  });

  it("creates non-default pane sessions on ready without restarting the default session", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const runtime = provider["sessionRuntime"];
    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("native");
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();
    const createSessionSpy = vi
      .spyOn(runtime, "createSession")
      .mockResolvedValue(undefined);
    vi.spyOn(runtime, "getSession").mockReturnValue(undefined);
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 96, rows: 28, paneId: "pane-ready" });
    await flushAsyncStartup();

    expect(createSessionSpy).toHaveBeenCalledWith("pane-ready", {
      paneId: "pane-ready",
      backend: "native",
    });
    expect(startSpy).not.toHaveBeenCalled();
  });

    it("enables paneCreate for tmux and zellij backends", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      provider = createProvider();
      const runtime = provider["sessionRuntime"];
      const createSessionSpy = vi
        .spyOn(runtime, "createSession")
        .mockResolvedValue(undefined);
      const { messageHandler } = resolveProvider(provider);

      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("tmux");
      messageHandler({ type: "paneCreate", paneId: "tmux-pane" });
      await flushAsyncStartup();

      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("zellij");
      messageHandler({ type: "paneCreate", paneId: "zellij-pane" });
      await flushAsyncStartup();

      expect(createSessionSpy).toHaveBeenCalledTimes(2);
      expect(provider["paneStore"].getPane("tmux-pane")).toBeDefined();
      expect(provider["paneStore"].getPane("zellij-pane")).toBeDefined();
    });

  it("uses defaultAiTool config for non-tmux sessions", async () => {
    mockConfiguration({
      autoStartOnOpen: false,
      enableHttpApi: false,
      defaultAiTool: "codex",
    });
    provider = createProvider();
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 120, rows: 40 });
    await flushAsyncStartup();

    expect(createTerminalSpy).toHaveBeenCalledWith(
      "opencode-main",
      "codex",
      {},
      undefined,
      120,
      40,
      "opencode-main",
      expect.any(String),
    );
  });

  it("launches the selected tmux AI tool and stores it on the mapped instance", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-codex",
        workspaceUri: "file:///workspaces/repo-codex",
      },
      runtime: { terminalKey: "workspace-codex", tmuxSessionId: "tmux-codex" },
      state: "connected",
    });
    const listPanes = vi
      .fn()
      .mockResolvedValue([{ paneId: "%1", isActive: true }]);
    const sendTextToPane = vi.fn().mockResolvedValue(undefined);
    const tmuxSessionManager = {
      listPanes,
      sendTextToPane,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    resolveProvider(provider);
    vi.spyOn((provider as any).sessionRuntime, "getActiveBackend").mockReturnValue("tmux");

    await provider.launchAiTool("tmux-codex", "codex", true);

    expect(sendTextToPane).toHaveBeenCalledWith("%1", "codex");
    expect(instanceStore.get("workspace-codex")?.config.selectedAiTool).toBe(
      "codex",
    );
  });

  it("formats editor references with the active tool", async () => {
    mockConfiguration({
      autoStartOnOpen: false,
      enableHttpApi: false,
      defaultAiTool: "codex",
    });
    provider = createProvider();
    resolveProvider(provider);

    const editor = {
      document: {
        uri: { fsPath: "/workspaces/repo-a/src/example.ts", path: "" },
      },
      selection: {
        isEmpty: false,
        start: { line: 4 },
        end: { line: 6 },
      },
    } as any;
    vi.mocked(vscode.workspace.asRelativePath).mockReturnValueOnce(
      "src/example.ts",
    );

    await provider.startOpenCode();

    expect(provider.formatEditorReference(editor)).toBe(
      "@src/example.ts#L5-L7",
    );
  });

  it("ensures and reuses a matching tmux workspace session on startup", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-a",
        workspaceUri: "file:///workspaces/repo-a",
      },
      runtime: { terminalKey: "workspace-a" },
      state: "connected",
    });
    const ensureSession = vi.fn().mockResolvedValue({
      action: "attached",
      session: {
        id: "repo-a-tmux",
        name: "repo-a-tmux",
        workspace: "repo-a",
        isActive: true,
      },
    });
    const tmuxSessionManager = {
      ensureSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 100, rows: 35 });
    await flushAsyncStartup();

    expect(ensureSession).toHaveBeenCalledWith("repo-a", "/workspaces/repo-a");
    expect(createTerminalSpy).toHaveBeenCalledWith(
      "workspace-a",
      "tmux attach-session -t repo-a-tmux \\; set-option -u status off",
      {},
      undefined,
      100,
      35,
      "workspace-a",
      "/workspaces/repo-a",
    );

    expect(instanceStore.get("workspace-a")?.runtime.tmuxSessionId).toBe(
      "repo-a-tmux",
    );
  });

  it("creates a workspace tmux session when none exists", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-b",
        workspaceUri: "file:///workspaces/repo-b",
      },
      runtime: { terminalKey: "workspace-b" },
      state: "connected",
    });
    const ensureSession = vi.fn().mockResolvedValue({
      action: "created",
      session: {
        id: "repo-b-tmux",
        name: "repo-b-tmux",
        workspace: "repo-b",
        isActive: true,
      },
    });
    const tmuxSessionManager = {
      ensureSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 120, rows: 40 });
    await flushAsyncStartup();

    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(ensureSession).toHaveBeenCalledWith("repo-b", "/workspaces/repo-b");
    expect(createTerminalSpy).toHaveBeenCalledWith(
      "workspace-b",
      "tmux attach-session -t repo-b-tmux \\; set-option -u status off",
      {},
      undefined,
      120,
      40,
      "workspace-b",
      "/workspaces/repo-b",
    );
    expect(instanceStore.get("workspace-b")?.runtime.tmuxSessionId).toBe(
      "repo-b-tmux",
    );
  });

  it("re-attaches to another workspace tmux session instead of creating a native shell fallback", async () => {
    mockConfiguration({
      autoStartOnOpen: false,
      enableHttpApi: false,
    });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-fallback",
        workspaceUri: "file:///workspaces/repo-fallback",
      },
      runtime: {
        terminalKey: "workspace-fallback",
        tmuxSessionId: "repo-fallback-1",
      },
      state: "connected",
    });
    const setMouseOn = vi.fn().mockResolvedValue(undefined);
    const configureMouseAndClipboard = vi.fn().mockResolvedValue(undefined);
    const killSession = vi.fn().mockResolvedValue(undefined);
    const findSessionForWorkspace = vi.fn().mockResolvedValue({
      id: "repo-fallback-2",
      name: "repo-fallback-2",
      workspace: "repo-fallback",
      isActive: true,
    });
    const tmuxSessionManager = {
      setMouseOn,
      configureMouseAndClipboard,
      killSession,
      findSessionForWorkspace,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToTmuxSession("repo-fallback-1");
    await flushAsyncStartup();
    await provider.killTmuxSession("repo-fallback-1");
    await flushAsyncStartup();

    expect(killSession).toHaveBeenCalledWith("repo-fallback-1");
    expect(findSessionForWorkspace).toHaveBeenCalledWith(
      "/workspaces/repo-fallback",
    );
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBe(
      "tmux attach-session -t repo-fallback-2 \\; set-option -u status off",
    );
    expect(instanceStore.get("workspace-fallback")?.runtime.tmuxSessionId).toBe(
      "repo-fallback-2",
    );
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it("does not duplicate startup orchestration on repeated ready messages", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-c",
        workspaceUri: "file:///workspaces/repo-c",
      },
      runtime: { terminalKey: "workspace-c" },
      state: "connected",
    });
    const ensureSession = vi.fn().mockResolvedValue({
      action: "attached",
      session: {
        id: "repo-c",
        name: "repo-c",
        workspace: "repo-c",
        isActive: true,
      },
    });
    const tmuxSessionManager = {
      ensureSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 110, rows: 34 });
    await flushAsyncStartup();
    messageHandler({ type: "ready", cols: 110, rows: 34 });
    await flushAsyncStartup();

    expect(ensureSession).toHaveBeenCalledTimes(1);
    expect(createTerminalSpy).toHaveBeenCalledTimes(1);
  });

  it("attaches to existing tmux session when no workspace is open", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const ensureSession = vi.fn().mockResolvedValue({
      action: "attached",
      session: {
        id: "home",
        name: "home",
        workspace: "home",
        isActive: true,
      },
    });
    const discoverSessions = vi.fn().mockResolvedValue([
      {
        id: "shared-session",
        name: "shared-session",
        workspace: "shared",
        isActive: true,
      },
    ]);
    const tmuxSessionManager = {
      ensureSession,
      discoverSessions,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 96, rows: 28 });
    await flushAsyncStartup();

    expect(ensureSession).not.toHaveBeenCalled();
    expect(discoverSessions).toHaveBeenCalledTimes(1);
    expect(createTerminalSpy).toHaveBeenCalledWith(
      "opencode-main",
      "tmux attach-session -t shared-session \\; set-option -u status off",
      {},
      undefined,
      96,
      28,
      "opencode-main",
      os.homedir(),
    );
  });

  it("forces attach to the selected tmux session when switching tabs", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-z-instance",
        workspaceUri: "file:///workspaces/repo-z",
      },
      runtime: { terminalKey: "workspace-z-instance", tmuxSessionId: "old-z" },
      state: "connected",
    });

    const ensureSession = vi.fn().mockResolvedValue({
      action: "attached",
      session: {
        id: "repo-z",
        name: "repo-z",
        workspace: "repo-z",
        isActive: true,
      },
    });
    const tmuxSessionManager = {
      ensureSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToTmuxSession("target-z");
    await flushAsyncStartup();

    expect(ensureSession).not.toHaveBeenCalled();
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    expect(lastCall?.[1]).toBe(
      "tmux attach-session -t target-z \\; set-option -u status off",
    );
    expect(lastCall?.[6]).toBe("workspace-z-instance");
  });

  it("switches to native shell without showing a dialog", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const ensureSession = vi.fn();
    const discoverSessions = vi.fn().mockResolvedValue([]);
    const tmuxSessionManager = {
      ensureSession,
      discoverSessions,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBeUndefined();
    expect(ensureSession).not.toHaveBeenCalled();
  });

  it("does not re-attach to tmux when switching to native shell in a workspace", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const ensureSession = vi.fn();
    const discoverSessions = vi.fn().mockResolvedValue([]);
    const tmuxSessionManager = {
      ensureSession,
      discoverSessions,
    } as unknown as TmuxSessionManager;

    vscode.workspace.workspaceFolders = [
      { uri: { fsPath: "/workspace/myproject" } },
    ] as any;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBeUndefined();
    expect(ensureSession).not.toHaveBeenCalled();
  });

  it("switches to native shell with default zsh (no AI tool command)", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const tmuxSessionManager = {
      ensureSession: vi.fn(),
      discoverSessions: vi.fn(),
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBeUndefined();
  });

  it("always proceeds with native shell switch regardless of any prior dialog state", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const tmuxSessionManager = {
      ensureSession: vi.fn(),
      discoverSessions: vi.fn(),
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(createTerminalSpy).toHaveBeenCalled();
  });

  it("switches to native shell without a dialog even when defaultAiTool is set", async () => {
    mockConfiguration({
      autoStartOnOpen: false,
      enableHttpApi: false,
      defaultAiTool: "opencode",
    });
    const tmuxSessionManager = {
      ensureSession: vi.fn(),
      discoverSessions: vi.fn(),
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    const lastCall =
      createTerminalSpy.mock.calls[createTerminalSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBeUndefined();
  });

  it("switches to native shell without showing a QuickPick or persisting any choice", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const tmuxSessionManager = {
      ensureSession: vi.fn(),
      discoverSessions: vi.fn(),
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    resolveProvider(provider);

    await provider.switchToNativeShell();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("creates a new tmux session and attaches the terminal immediately", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const discoverSessions = vi.fn().mockResolvedValue([
      { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: false },
      {
        id: "repo-a-2",
        name: "repo-a-2",
        workspace: "repo-a",
        isActive: false,
      },
    ]);
    const createSession = vi.fn().mockResolvedValue(undefined);
    const tmuxSessionManager = {
      discoverSessions,
      createSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    vscode.workspace.workspaceFolders = [
      {
        uri: {
          fsPath: "/workspaces/repo-a",
          toString: () => "file:///workspaces/repo-a",
        },
      },
    ] as any;

    const result = await provider.createTmuxSession();
    await flushAsyncStartup();

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith(
      "repo-a-3",
      "/workspaces/repo-a",
    );
    expect(result).toBe("repo-a-3");
    expect(createTerminalSpy).toHaveBeenCalled();
  });

  it("creates a new tmux session and launches opencode when user picks opencode", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const discoverSessions = vi.fn().mockResolvedValue([]);
    const createSession = vi.fn().mockResolvedValue(undefined);
    const ensureSession = vi.fn().mockResolvedValue({
      action: "created",
      session: {
        id: "repo-b",
        name: "repo-b",
        workspace: "repo-b",
        isActive: true,
      },
    });
    const tmuxSessionManager = {
      discoverSessions,
      createSession,
      ensureSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    const createTerminalSpy = vi.spyOn(terminalManager, "createTerminal");
    resolveProvider(provider);

    vscode.workspace.workspaceFolders = [
      {
        uri: {
          fsPath: "/workspaces/repo-b",
          toString: () => "file:///workspaces/repo-b",
        },
      },
    ] as any;

    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
      label: "$(terminal) OpenCode",
      description: "Launch OpenCode in the terminal",
    } as any);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
      undefined,
    );

    await provider.createTmuxSession();
    await flushAsyncStartup();

    expect(createSession).toHaveBeenCalledWith("repo-b", "/workspaces/repo-b");
    expect(createTerminalSpy).toHaveBeenCalled();
  });

  it("always creates the tmux session without showing a dialog", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const discoverSessions = vi.fn().mockResolvedValue([]);
    const createSession = vi.fn().mockResolvedValue(undefined);
    const tmuxSessionManager = {
      discoverSessions,
      createSession,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    resolveProvider(provider);

    vscode.workspace.workspaceFolders = [
      {
        uri: {
          fsPath: "/workspaces/repo-b",
          toString: () => "file:///workspaces/repo-b",
        },
      },
    ] as any;

    const result = await provider.createTmuxSession();

    expect(result).toBe("repo-b");
    expect(createSession).toHaveBeenCalledWith("repo-b", "/workspaces/repo-b");
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it("switches active instances without respawning when a terminal already exists", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: { id: "session-a" },
      runtime: { terminalKey: "session-a" },
      state: "connected",
    });
    instanceStore.upsert({
      config: { id: "session-b" },
      runtime: { terminalKey: "session-b" },
      state: "connected",
    });

    provider = createProvider({ instanceStore });
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();
    const resizeSpy = vi.spyOn(terminalManager, "resizeTerminal");
    terminalManager.createTerminal(
      "session-b",
      "opencode",
      {},
      undefined,
      undefined,
      undefined,
      "session-b",
    );

    const { view } = resolveProvider(provider);
    (provider as any).lastKnownCols = 90;
    (provider as any).lastKnownRows = 30;

    instanceStore.setActive("session-b");
    await Promise.resolve();

    expect((provider as any).activeInstanceId).toBe("session-b");
    expect(startSpy).not.toHaveBeenCalled();
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      paneId: "default",
      type: "clearTerminal",
    });
    expect(resizeSpy).toHaveBeenCalledWith("session-b", 90, 30);
  });

  it("switches active instances and spawns a new terminal when it does not exist", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: { id: "session-a" },
      runtime: { terminalKey: "session-a" },
      state: "connected",
    });
    instanceStore.upsert({
      config: { id: "session-c" },
      runtime: { terminalKey: "session-c" },
      state: "connected",
    });

    provider = createProvider({ instanceStore });
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();

    const { view } = resolveProvider(provider);

    instanceStore.setActive("session-c");
    await Promise.resolve();

    expect((provider as any).activeInstanceId).toBe("session-c");
    expect(startSpy).toHaveBeenCalled();
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      paneId: "default",
      type: "clearTerminal",
    });
  });

  it("normalizes workspace session ids when launching the default AI tool", async () => {
    mockConfiguration({ defaultAiTool: "opencode" });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-saved-tool",
        workspaceUri: "file:///workspaces/repo-saved-tool",
        selectedAiTool: "codex",
      },
      runtime: {
        terminalKey: "workspace-saved-tool",
        tmuxSessionId: "tmux-saved-tool",
      },
      state: "connected",
    });

    provider = createProvider({ instanceStore });
    const launchSpy = vi.spyOn(provider, "launchAiTool").mockResolvedValue();

    await provider.launchDefaultAiTool("repo-saved-tool", "%22");

    expect(launchSpy).toHaveBeenCalledWith(
      "tmux-saved-tool",
      "codex",
      false,
      "%22",
      undefined,
    );
  });

  it("uses the configured default AI tool when no instance preference exists", async () => {
    mockConfiguration({ defaultAiTool: "claude" });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-default-tool",
        workspaceUri: "file:///workspaces/repo-default-tool",
      },
      runtime: {
        terminalKey: "workspace-default-tool",
        tmuxSessionId: "tmux-default-tool",
      },
      state: "connected",
    });

    provider = createProvider({ instanceStore });
    const launchSpy = vi.spyOn(provider, "launchAiTool").mockResolvedValue();

    await provider.launchDefaultAiTool("repo-default-tool");

    expect(launchSpy).toHaveBeenCalledWith(
      "tmux-default-tool",
      "claude",
      false,
      undefined,
      undefined,
    );
  });

  it("launches the saved tool directly instead of forcing a selector", async () => {
    mockConfiguration({ defaultAiTool: "opencode" });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-force-show",
        workspaceUri: "file:///workspaces/repo-force-show",
        selectedAiTool: "codex",
      },
      runtime: {
        terminalKey: "workspace-force-show",
        tmuxSessionId: "tmux-force-show",
      },
      state: "connected",
    });

    provider = createProvider({ instanceStore });
    const launchSpy = vi.spyOn(provider, "launchAiTool").mockResolvedValue();
    resolveProvider(provider);

    await provider.launchDefaultAiTool("repo-force-show", "%9");

    expect(launchSpy).toHaveBeenCalledWith(
      "tmux-force-show",
      "codex",
      false,
      "%9",
      undefined,
    );
  });

  it("ignores non-selector messages when a boolean postMessage reports false", () => {
    mockConfiguration();
    provider = createProvider();
    const { view } = resolveProvider(provider);
    vi.mocked(view.webview.postMessage).mockReturnValue(false);

    (provider as any).postWebviewMessage({ type: "output", text: "hello" });

    expect(provider["pendingWebviewMessages"]).toHaveLength(0);
  });

  it("ignores non-selector messages when no webview is attached", () => {
    mockConfiguration();
    provider = createProvider();

    (provider as any).postWebviewMessage({ type: "output", text: "hello" });

    expect(provider["pendingWebviewMessages"]).toHaveLength(0);
  });

  it("ignores non-selector Thenable messages when the webview is hidden", () => {
    mockConfiguration();
    provider = createProvider();
    const { view } = resolveProvider(provider);
    view.visible = false;
    vi.mocked(view.webview.postMessage).mockReturnValue({
      then: (resolve: (value: boolean) => void) => {
        resolve(false);
        return Promise.resolve(false);
      },
    } as any);

    (provider as any).postWebviewMessage({ type: "output", text: "hello" });

    expect(provider["pendingWebviewMessages"]).toHaveLength(0);
  });

  it("ignores non-selector messages when flushing a false postMessage result", () => {
    mockConfiguration();
    provider = createProvider();
    const { view } = resolveProvider(provider);
    vi.mocked(view.webview.postMessage).mockReturnValue(false);

    provider["pendingWebviewMessages"].push({ type: "output", text: "hello" } as any);
    (provider as any).flushPendingWebviewMessages(view.webview);

    expect(provider["pendingWebviewMessages"]).toHaveLength(0);
  });

  it("routes AI tool launches to tmux when an instance is tmux mapped", async () => {
    mockConfiguration();
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-tmux-launch-route",
        workspaceUri: "file:///workspaces/repo-tmux-launch-route",
      },
      runtime: {
        terminalKey: "workspace-tmux-launch-route",
        tmuxSessionId: "tmux-session-x",
      },
      state: "connected",
    });
    const listPanes = vi
      .fn()
      .mockResolvedValue([{ paneId: "%42", isActive: true }]);
    const sendTextToPane = vi.fn().mockResolvedValue(undefined);
    const tmuxSessionManager = {
      listPanes,
      sendTextToPane,
    } as unknown as TmuxSessionManager;
    const zellijSessionManager = {
      switchSession: vi.fn(),
      selectPane: vi.fn(),
      sendTextToPane: vi.fn(),
    } as any;

    provider = createProvider({
      instanceStore,
      tmuxSessionManager,
      zellijSessionManager,
    });

    await provider.launchAiTool("tmux-session-x", "codex", false, "%42");

    expect(sendTextToPane).toHaveBeenCalledWith("%42", "codex");
    expect(zellijSessionManager.switchSession).not.toHaveBeenCalled();
    expect(zellijSessionManager.selectPane).not.toHaveBeenCalled();
    expect(zellijSessionManager.sendTextToPane).not.toHaveBeenCalled();
  });

  it("switches to the target zellij session before launching into a pane", async () => {
    mockConfiguration();
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-zellij-launch-route",
        workspaceUri: "file:///workspaces/repo-zellij-launch-route",
      },
      runtime: {
        terminalKey: "workspace-zellij-launch-route",
        zellijSessionId: "zellij-target",
      },
      state: "connected",
    });
    const switchSession = vi.fn().mockResolvedValue(undefined);
    const selectPane = vi.fn().mockResolvedValue(undefined);
    const sendTextToPane = vi.fn().mockResolvedValue(undefined);
    const zellijSessionManager = {
      isAvailable: vi.fn().mockResolvedValue(true),
      switchSession,
      selectPane,
      sendTextToPane,
    } as any;

    provider = createProvider({ instanceStore, zellijSessionManager });
    vi.spyOn((provider as any).sessionRuntime, "getActiveBackend").mockReturnValue("zellij");

    await provider.launchAiTool("zellij-target", "opencode", false, "pane-7");

    expect(switchSession).toHaveBeenCalledWith("zellij-target");
    expect(selectPane).toHaveBeenCalledWith("pane-7");
    expect(sendTextToPane).toHaveBeenCalledWith("opencode -c", {
      submit: true,
    });
    expect(switchSession.mock.invocationCallOrder[0]).toBeLessThan(
      selectPane.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(switchSession.mock.invocationCallOrder[0]).toBeLessThan(
      sendTextToPane.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("launches AI tools against the normalized tmux session and active pane", async () => {
    const configuration = mockConfiguration();
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-launch",
        workspaceUri: "file:///workspaces/repo-launch",
      },
      runtime: {
        terminalKey: "workspace-launch",
        tmuxSessionId: "tmux-launch",
      },
      state: "connected",
    });
    const listPanes = vi.fn().mockResolvedValue([
      { paneId: "%1", isActive: false },
      { paneId: "%2", isActive: true },
    ]);
    const sendTextToPane = vi.fn().mockResolvedValue(undefined);
    const tmuxSessionManager = {
      listPanes,
      sendTextToPane,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    vi.spyOn((provider as any).sessionRuntime, "getActiveBackend").mockReturnValue("tmux");

    await provider.launchAiTool("repo-launch", "codex", true);

    expect(configuration.update).toHaveBeenCalledWith(
      "defaultAiTool",
      "codex",
      vscode.ConfigurationTarget.Global,
    );
    expect(listPanes).toHaveBeenCalledWith("tmux-launch", {
      activeWindowOnly: true,
    });
    expect(sendTextToPane).toHaveBeenCalledWith("%2", "codex");
    expect(instanceStore.get("workspace-launch")?.config.selectedAiTool).toBe(
      "codex",
    );
  });

  it("uses the provided pane id and original session id when no tmux mapping exists", async () => {
    mockConfiguration();
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "workspace-direct-pane",
        workspaceUri: "file:///workspaces/repo-direct-pane",
      },
      runtime: {
        terminalKey: "workspace-direct-pane",
      },
      state: "connected",
    });
    const listPanes = vi.fn();
    const sendTextToPane = vi.fn().mockResolvedValue(undefined);
    const tmuxSessionManager = {
      listPanes,
      sendTextToPane,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ instanceStore, tmuxSessionManager });
    vi.spyOn((provider as any).sessionRuntime, "getActiveBackend").mockReturnValue("tmux");

    await provider.launchAiTool("repo-direct-pane", "opencode", false, "%77");

    expect(listPanes).not.toHaveBeenCalled();
    expect(sendTextToPane).toHaveBeenCalledWith("%77", "opencode -c");
    expect(
      instanceStore.get("workspace-direct-pane")?.config.selectedAiTool,
    ).toBe("opencode");
  });

  it("saves the tool preference even when tmux is unavailable", async () => {
    const configuration = mockConfiguration();
    provider = createProvider();

    await provider.launchAiTool("repo-no-tmux", "claude", true);

    expect(configuration.update).toHaveBeenCalledWith(
      "defaultAiTool",
      "claude",
      vscode.ConfigurationTarget.Global,
    );
  });

  it("returns early when the requested AI tool is not configured", async () => {
    const configuration = mockConfiguration();
    const listPanes = vi.fn();
    const sendTextToPane = vi.fn();
    const tmuxSessionManager = {
      listPanes,
      sendTextToPane,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });

    await provider.launchAiTool("repo-missing-tool", "missing-tool", true);

    expect(configuration.update).toHaveBeenCalledWith(
      "defaultAiTool",
      "missing-tool",
      vscode.ConfigurationTarget.Global,
    );
    expect(listPanes).not.toHaveBeenCalled();
    expect(sendTextToPane).not.toHaveBeenCalled();
  });

  it("warns when no tmux pane can be resolved for AI tool launch", async () => {
    mockConfiguration();
    const listPanes = vi.fn().mockResolvedValue([]);
    const sendTextToPane = vi.fn();
    const tmuxSessionManager = {
      listPanes,
      sendTextToPane,
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    vi.spyOn((provider as any).sessionRuntime, "getActiveBackend").mockReturnValue("tmux");
    const warnSpy = vi.spyOn((provider as any).logger, "warn");

    await provider.launchAiTool("repo-no-pane", "codex", false);

    expect(sendTextToPane).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("launchAiTool skipped: no target pane"),
    );
  });

  it("warns when tmux commands fail during AI tool launch", async () => {
    mockConfiguration();
    const tmuxSessionManager = {
      listPanes: vi.fn().mockRejectedValue(new Error("tmux unavailable")),
      sendTextToPane: vi.fn(),
    } as unknown as TmuxSessionManager;

    provider = createProvider({ tmuxSessionManager });
    vi.spyOn((provider as any).sessionRuntime, "getActiveBackend").mockReturnValue("tmux");
    const warnSpy = vi.spyOn((provider as any).logger, "warn");

    await provider.launchAiTool("repo-launch-error", "codex", false);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to launch AI tool: tmux unavailable"),
    );
  });

  it("launches AI tool against zellij focused pane when zellij backend active", async () => {
    mockConfiguration();
    const zellijSelectPane = vi.fn().mockResolvedValue(undefined);
    const zellijSendTextToPane = vi.fn().mockResolvedValue(undefined);
    const zellijSessionManager = {
      isAvailable: vi.fn().mockResolvedValue(true),
      selectPane: zellijSelectPane,
      sendTextToPane: zellijSendTextToPane,
    } as any;

    provider = createProvider({ zellijSessionManager });
    vi.spyOn((provider as any).sessionRuntime, "getActiveBackend").mockReturnValue("zellij");

    await provider.launchAiTool("zellij-session", "codex", false, "terminal_5");

    expect(zellijSelectPane).toHaveBeenCalledWith("terminal_5");
    expect(zellijSendTextToPane).toHaveBeenCalledWith("codex", { submit: true });
  });

  it("honors the explicit backendHint when launching an AI tool", async () => {
    mockConfiguration();
    provider = createProvider();
    const warnSpy = vi.spyOn((provider as any).logger, "warn");

    await provider.launchAiTool(
      "session-backend-hint",
      "codex",
      false,
      undefined,
      "native",
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("backend native does not support pane targeting"),
    );
  });

  it("executeRawTmuxCommand rejects when active backend is not tmux", async () => {
    mockConfiguration();
    provider = createProvider();
    vi.spyOn((provider as any).sessionRuntime, "getActiveBackend").mockReturnValue("zellij");

    await expect(provider.executeRawTmuxCommand("rename-session")).rejects.toThrow(
      /only supported on the tmux backend/i,
    );
  });

  it("sends prompts through the HTTP client when available", async () => {
    mockConfiguration();
    provider = createProvider();
    const appendPrompt = vi.fn().mockResolvedValue(undefined);
    const runtime = (provider as any).sessionRuntime;

    vi.spyOn(runtime, "getApiClient").mockReturnValue({ appendPrompt } as any);
    vi.spyOn(runtime, "isHttpAvailable").mockReturnValue(true);
    const writeSpy = vi.spyOn(terminalManager, "writeToTerminal");

    await provider.sendPrompt("hello via http");

    expect(appendPrompt).toHaveBeenCalledWith("hello via http");
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("falls back to terminal writes when the HTTP prompt append fails", async () => {
    mockConfiguration();
    provider = createProvider();
    const appendPrompt = vi.fn().mockRejectedValue(new Error("network down"));
    const runtime = (provider as any).sessionRuntime;

    vi.spyOn(runtime, "getApiClient").mockReturnValue({ appendPrompt } as any);
    vi.spyOn(runtime, "isHttpAvailable").mockReturnValue(true);
    const writeSpy = vi.spyOn(terminalManager, "writeToTerminal");
    const warnSpy = vi.spyOn((provider as any).logger, "warn");

    await provider.sendPrompt("hello fallback");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "HTTP API send failed, falling back to terminal write: network down",
      ),
    );
    expect(writeSpy).toHaveBeenCalledWith("opencode-main", "hello fallback");
  });

  it("resets stale runtime state and starts immediately when a visible webview opens", () => {
    mockConfiguration({ autoStartOnOpen: true });
    provider = createProvider();
    const runtime = (provider as any).sessionRuntime;

    vi.spyOn(runtime, "hasLiveTerminalProcess").mockReturnValue(false);
    vi.spyOn(runtime, "isStartedFlag")
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const resetStateSpy = vi.spyOn(runtime, "resetState");
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();

    resolveProvider(provider);

    expect(resetStateSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("does not auto-start when autoStartOnOpen is disabled", () => {
    mockConfiguration({ autoStartOnOpen: false });
    provider = createProvider();
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();

    resolveProvider(provider);

    expect(startSpy).not.toHaveBeenCalled();
  });

  it("waits for visibility before auto-starting hidden webviews", () => {
    mockConfiguration({ autoStartOnOpen: true });
    provider = createProvider();
    const view = vscode.WebviewView() as any;
    view.visible = false;
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();

    provider.resolveWebviewView(view, {} as any, {} as any);

    expect(startSpy).not.toHaveBeenCalled();

    const visibilityListener = vi.mocked(view.onDidChangeVisibility).mock
      .calls[0]?.[0] as () => void;
    view.visible = true;
    visibilityListener();

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      paneId: "default",
      type: "webviewVisible",
    });
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("opens the terminal renderer in an editor tab and locks its editor group", async () => {
    mockConfiguration();
    provider = createProvider();
    resolveProvider(provider);

    await provider.openInEditorTab();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      "ulw.terminalEditor",
      "ULW Terminal",
      vscode.ViewColumn.Beside,
      expect.any(Object),
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.lockEditorGroup",
    );
  });

  it("closes the auxiliary bar (secondary sidebar) when opening the editor tab and collapse-on-open is enabled", async () => {
    mockConfiguration({ collapseSecondaryBarOnEditorOpen: true });
    provider = createProvider();
    resolveProvider(provider);

    await provider.openInEditorTab();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.closeAuxiliaryBar",
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.lockEditorGroup",
    );
  });

  it("closes the auxiliary bar before creating the editor panel to avoid layout race", async () => {
    mockConfiguration({ collapseSecondaryBarOnEditorOpen: true });
    provider = createProvider();
    resolveProvider(provider);

    await provider.openInEditorTab();

    const executeCalls = vi.mocked(vscode.commands.executeCommand).mock.calls;
    const executeOrders = vi.mocked(vscode.commands.executeCommand).mock
      .invocationCallOrder;

    const closeAuxIdx = executeCalls.findIndex(
      (args) => args[0] === "workbench.action.closeAuxiliaryBar",
    );
    const createOrder = vi.mocked(vscode.window.createWebviewPanel).mock
      .invocationCallOrder[0];

    expect(executeOrders[closeAuxIdx]).toBeLessThan(createOrder);
  });

  it("keeps the sidebar open when opening the editor tab and collapse-on-open is disabled", async () => {
    mockConfiguration({ collapseSecondaryBarOnEditorOpen: false });
    provider = createProvider();
    resolveProvider(provider);

    await provider.openInEditorTab();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "workbench.action.closeAuxiliaryBar",
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.lockEditorGroup",
    );
  });

  it("opens another editor terminal panel instead of reusing the existing one", async () => {
    mockConfiguration();
    provider = createProvider();
    resolveProvider(provider);

    await provider.openInEditorTab();
    const focusSpy = vi.spyOn(provider, "focus");

    await provider.openInEditorTab();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    expect(focusSpy).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2);
    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(
      1,
      "workbench.action.lockEditorGroup",
    );
    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(
      2,
      "workbench.action.lockEditorGroup",
    );
  });

  it("creates independent tmux-backed pane sessions for separate editor terminal panels", async () => {
    mockConfiguration();
    provider = createProvider();
    resolveProvider(provider);
    const runtime = provider["sessionRuntime"];
    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("tmux");
    vi.spyOn(runtime, "getSession").mockImplementation((paneId: string) =>
      paneId === "default"
        ? ({
            paneId: "default",
            instanceId: "opencode-main",
            terminalKey: "opencode-main",
            backend: "tmux",
            tmuxSessionId: "shared-session",
          } as never)
        : undefined,
    );
    const createSessionSpy = vi
      .spyOn(runtime, "createSession")
      .mockResolvedValue(undefined);

    await provider.openInEditorTab();
    await provider.openInEditorTab();
    const firstPanel = vi.mocked(vscode.window.createWebviewPanel).mock
      .results[0]?.value as any;
    const secondPanel = vi.mocked(vscode.window.createWebviewPanel).mock
      .results[1]?.value as any;
    const firstHandler = vi.mocked(firstPanel.webview.onDidReceiveMessage).mock
      .calls[0]?.[0] as (message: any) => void;
    const secondHandler = vi.mocked(secondPanel.webview.onDidReceiveMessage).mock
      .calls[0]?.[0] as (message: any) => void;

    firstHandler({ type: "ready", cols: 120, rows: 40 });
    secondHandler({ type: "ready", cols: 120, rows: 40 });
    await flushAsyncStartup();

    expect(createSessionSpy).toHaveBeenCalledWith("ulw-editor-1", {
      paneId: "ulw-editor-1",
      backend: "tmux",
      backendConfig: { tmux: { sessionId: "shared-session" } },
    });
    expect(createSessionSpy).toHaveBeenCalledWith("ulw-editor-2", {
      paneId: "ulw-editor-2",
      backend: "tmux",
      backendConfig: { tmux: { sessionId: "shared-session" } },
    });
  });

  it("replays the active session state to the editor panel so the toolbar stays visible", async () => {
    mockConfiguration();
    provider = createProvider();
    const runtime = (provider as any).sessionRuntime;
    vi.spyOn(runtime, "getSelectedTmuxSessionId").mockReturnValue(
      "tmux-selected",
    );
    vi.spyOn(runtime, "resolveTmuxSessionIdForInstance").mockReturnValue(
      undefined,
    );
    resolveProvider(provider);

    await provider.openInEditorTab();

    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as any;
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "activeSession",
      sessionName: "tmux-selected",
      sessionId: "tmux-selected",
      backend: "tmux",
    });
  });

  it("executes the dashboard command when toggling the dashboard", () => {
    mockConfiguration();
    provider = createProvider();

    provider.toggleDashboard();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.openTerminalManager",
    );
  });

  it("posts a webview message when toggling the tmux command toolbar", () => {
    mockConfiguration();
    provider = createProvider();
    const runtime = (provider as any).sessionRuntime;
    vi.spyOn(runtime, "getSelectedTmuxSessionId").mockReturnValue(
      "tmux-selected",
    );
    const { view } = resolveProvider(provider);

    provider.toggleTmuxCommandToolbar();

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "toggleTmuxCommandToolbar",
    });
  });

  it("posts a webview message when the active instance has a tmux session", () => {
    mockConfiguration();
    provider = createProvider();
    const runtime = (provider as any).sessionRuntime;
    vi.spyOn(runtime, "getSelectedTmuxSessionId").mockReturnValue(undefined);
    vi.spyOn(runtime, "resolveTmuxSessionIdForInstance").mockReturnValue(
      "tmux-active",
    );
    const { view } = resolveProvider(provider);

    provider.toggleTmuxCommandToolbar();

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "toggleTmuxCommandToolbar",
    });
  });

  it("does not post a webview message when no tmux session is attached", () => {
    mockConfiguration();
    provider = createProvider();
    const runtime = (provider as any).sessionRuntime;
    vi.spyOn(runtime, "getSelectedTmuxSessionId").mockReturnValue(undefined);
    vi.spyOn(runtime, "resolveTmuxSessionIdForInstance").mockReturnValue(
      undefined,
    );
    const { view } = resolveProvider(provider);

    provider.toggleTmuxCommandToolbar();

    expect(view.webview.postMessage).not.toHaveBeenCalledWith({
      type: "toggleTmuxCommandToolbar",
    });
  });

  it("delegates public runtime wrapper methods to SessionRuntime", async () => {
    mockConfiguration();
    provider = createProvider();
    const runtime = (provider as any).sessionRuntime;
    const apiClient = { appendPrompt: vi.fn() };
    const fileReference = "@src/example.ts#L1-L3";

    vi.spyOn(runtime, "getApiClient").mockReturnValue(apiClient as any);
    vi.spyOn(runtime, "isHttpAvailable").mockReturnValue(true);
    const restartSpy = vi
      .spyOn(runtime, "restart")
      .mockImplementation(() => {});
    const switchToInstanceSpy = vi
      .spyOn(runtime, "switchToInstance")
      .mockResolvedValue(undefined);
    const switchToTmuxSpy = vi
      .spyOn(runtime, "switchToTmuxSession")
      .mockResolvedValue(undefined);
    vi.spyOn(runtime, "resolveInstanceIdFromSessionId").mockReturnValue(
      "workspace-wrapper",
    );
    const switchToNativeSpy = vi
      .spyOn(runtime, "switchToNativeShell")
      .mockResolvedValue(undefined);
    vi.spyOn(runtime, "createTmuxSession").mockResolvedValue("tmux-wrapper");
    const killSessionSpy = vi
      .spyOn(runtime, "killTmuxSession")
      .mockResolvedValue(undefined);
    vi.spyOn(runtime, "getSelectedTmuxSessionId").mockReturnValue(
      "tmux-selected",
    );
    const zoomSpy = vi
      .spyOn(runtime, "zoomTmuxPane")
      .mockResolvedValue(undefined);
    vi.spyOn(runtime, "formatFileReference").mockReturnValue(fileReference);

    expect(provider.getApiClient()).toBe(apiClient);
    expect(provider.isHttpAvailable()).toBe(true);

    provider.restart();
    expect(restartSpy).toHaveBeenCalledTimes(1);

    await provider.switchToInstance("workspace-wrapper", {
      forceRestart: true,
    });
    expect(switchToInstanceSpy).toHaveBeenCalledWith("workspace-wrapper", {
      forceRestart: true,
    });

    await provider.switchToTmuxSession("tmux-wrapper");
    expect(switchToTmuxSpy).toHaveBeenCalledWith("tmux-wrapper");

    expect(provider.resolveInstanceIdFromSessionId("repo-wrapper")).toBe(
      "workspace-wrapper",
    );

    await provider.switchToNativeShell();
    expect(switchToNativeSpy).toHaveBeenCalledTimes(1);

    await expect(provider.createTmuxSession()).resolves.toBe("tmux-wrapper");

    await provider.killTmuxSession("tmux-wrapper");
    expect(killSessionSpy).toHaveBeenCalledWith("tmux-wrapper");

    expect(provider.getSelectedTmuxSessionId()).toBe("tmux-selected");

    await provider.zoomTmuxPane();
    expect(zoomSpy).toHaveBeenCalledTimes(1);

    expect(provider.formatFileReference({ path: "src/example.ts" })).toBe(
      fileReference,
    );

    const rawTmuxManager = {
      executeRawCommand: vi.fn(async () => "raw-result"),
    } as unknown as TmuxSessionManager;
    const activeStore = new InstanceStore();
    activeStore.upsert({
      config: {
        id: "workspace-raw",
        workspaceUri: "file:///workspaces/raw",
      },
      runtime: { terminalKey: "workspace-raw", tmuxSessionId: "tmux-active" },
      state: "connected",
    });
    activeStore.setActive("workspace-raw");
    provider = createProvider({
      instanceStore: activeStore,
      tmuxSessionManager: rawTmuxManager,
    });
    vi.spyOn((provider as any).sessionRuntime, "getActiveBackend").mockReturnValue("tmux");
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(
      "renamed-session",
    );

    await expect(
      provider.executeRawTmuxCommand("rename-session"),
    ).resolves.toBe("raw-result");
    expect(rawTmuxManager.executeRawCommand).toHaveBeenCalledWith(
      "tmux-active",
      "rename-session",
      ["renamed-session"],
    );
  });

  it("formats URI references, posts clipboard content, and tracks terminal size", () => {
    mockConfiguration();
    provider = createProvider();
    const formatSpy = vi
      .spyOn(provider, "formatFileReference")
      .mockReturnValue("@src/from-uri.ts");
    const { view } = resolveProvider(provider);

    expect(
      provider.formatUriReference({
        fsPath: "/workspaces/repo-a/src/from-uri.ts",
        path: "/workspaces/repo-a/src/from-uri.ts",
      } as any),
    ).toBe("@src/from-uri.ts");
    expect(formatSpy).toHaveBeenCalledWith({
      path: "/workspaces/repo-a/src/from-uri.ts",
    });

    provider.pasteText("clipboard payload");
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "clipboardContent",
      text: "clipboard payload",
    });

    provider.requestPaste();
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "requestPaste",
    });

    provider.lastKnownCols = 132;
    provider.lastKnownRows = 44;

    expect(provider.lastKnownCols).toBe(132);
    expect(provider.lastKnownRows).toBe(44);
  });

  it("covers router bridge wrappers for zellij, backend selection, paste, resize, and command toggles", async () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler, view } = resolveProvider(provider);
    const runtime = provider["sessionRuntime"];

    const switchZellijSpy = vi
      .spyOn(runtime, "switchToZellijSession")
      .mockResolvedValue(undefined);
    const selectBackendSpy = vi
      .spyOn(runtime, "selectTerminalBackend")
      .mockResolvedValue(undefined);
    const cycleBackendSpy = vi
      .spyOn(runtime, "cycleTerminalBackend")
      .mockResolvedValue(undefined);
    const resizeSpy = vi.spyOn(terminalManager, "resizeTerminal");

    messageHandler({ type: "selectTerminalBackend", backend: "zellij" });
    messageHandler({ type: "cycleTerminalBackend" });
    await provider.switchToZellijSession("zellij-a");
    await provider.selectTerminalBackend("native");
    await provider.cycleTerminalBackend();
    provider.pasteText("from bridge");
    provider.lastKnownCols = 88;
    provider.lastKnownRows = 24;
    messageHandler({ type: "terminalResize", cols: 120, rows: 33 });

    expect(selectBackendSpy).toHaveBeenCalledWith("zellij");
    expect(selectBackendSpy).toHaveBeenCalledWith("native");
    expect(cycleBackendSpy).toHaveBeenCalledTimes(2);
    expect(switchZellijSpy).toHaveBeenCalledWith("zellij-a");
    expect(resizeSpy).toHaveBeenCalledWith("opencode-main", 120, 33);
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "clipboardContent",
      text: "from bridge",
    });
  });

  it("handles auto-start visibility paths with direct native restore", async () => {
    mockConfiguration({ autoStartOnOpen: true });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: {
        id: "native-hidden-restore",
        selectedAiTool: "codex",
        terminalBackend: "native",
      },
      runtime: { terminalKey: "native-hidden-restore" },
      state: "disconnected",
    });
    provider = createProvider({ instanceStore });
    const startSpy = vi
      .spyOn(provider["sessionRuntime"], "startOpenCode")
      .mockResolvedValue(undefined);
    const view = vscode.WebviewView() as never as ReturnType<typeof vscode.WebviewView>;
    view.visible = false;
    provider.resolveWebviewView(view as never, {} as never, {} as never);

    const visibilityListener = vi.mocked(view.onDidChangeVisibility).mock
      .calls[0]?.[0] as () => void;
    view.visible = true;
    visibilityListener();
    await flushAsyncStartup();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalledTimes(1);

    visibilityListener();
    await flushAsyncStartup();

    expect(startSpy).toHaveBeenCalledTimes(2);
  });

  it("logs native restore lookup failures and falls back to autostart", () => {
    mockConfiguration({ autoStartOnOpen: true });
    const failingStore = new InstanceStore();
    vi.spyOn(failingStore, "getActive").mockImplementation(() => {
      throw new Error("store down");
    });
    provider = createProvider({ instanceStore: failingStore });
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();
    const infoSpy = vi.spyOn(provider["logger"], "info");

    resolveProvider(provider);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("Native restore skipped: store down"),
    );
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("reconnects live editor panels and reposts config when an editor panel is disposed with sidebar still present", async () => {
    mockConfiguration();
    provider = createProvider();
    const runtime = provider["sessionRuntime"];
    vi.spyOn(runtime, "hasLiveTerminalProcess").mockReturnValue(true);
    vi.spyOn(runtime, "isStartedFlag").mockReturnValue(true);
    const reconnectSpy = vi.spyOn(runtime, "reconnectListeners");
    const { view } = resolveProvider(provider);
    vi.mocked(view.webview.postMessage).mockClear();

    await provider.openInEditorTab();
    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value;
    const disposeListener = vi.mocked(panel.onDidDispose).mock.calls[0]?.[0] as
      | (() => void)
      | undefined;

    disposeListener?.();

    expect(reconnectSpy).toHaveBeenCalledTimes(2);
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      paneId: "default",
      type: "webviewVisible",
    });
  });

  it("posts zellij and native active session states to newly initialized editor panels", async () => {
    mockConfiguration();
    provider = createProvider();
    const runtime = provider["sessionRuntime"];
    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("zellij");
    vi.spyOn(runtime, "resolveZellijSessionIdForInstance").mockReturnValue(
      "zellij-active",
    );
    vi.spyOn(runtime, "getSelectedTmuxSessionId").mockReturnValue(undefined);
    vi.spyOn(runtime, "resolveTmuxSessionIdForInstance").mockReturnValue(
      undefined,
    );

    await provider.openInEditorTab();
    let panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value;
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "activeSession",
      sessionName: "zellij-active",
      sessionId: "zellij-active",
      backend: "zellij",
    });

    const disposeListener = vi.mocked(panel.onDidDispose).mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    disposeListener?.();
    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("native");
    vi.spyOn(runtime, "resolveZellijSessionIdForInstance").mockReturnValue(
      undefined,
    );
    await provider.openInEditorTab();
    panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[1]?.value;
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "activeSession",
      backend: "native",
    });
  });

  it("rejects invalid raw tmux commands, missing managers, missing sessions, and cancelled prompts", async () => {
    mockConfiguration();
    provider = createProvider();
    vi.spyOn(provider["sessionRuntime"], "getActiveBackend").mockReturnValue(
      "tmux",
    );
    await expect(provider.executeRawTmuxCommand("rename-session")).rejects.toThrow(
      /tmux session manager unavailable/i,
    );

    const inactiveManager = {
      executeRawCommand: vi.fn(async () => "unused"),
    } as never as TmuxSessionManager;
    provider = createProvider({ tmuxSessionManager: inactiveManager });
    vi.spyOn(provider["sessionRuntime"], "getActiveBackend").mockReturnValue(
      "tmux",
    );
    await expect(provider.executeRawTmuxCommand("rename-session")).rejects.toThrow(
      /No active tmux session/i,
    );

    const activeStore = new InstanceStore();
    activeStore.upsert({
      config: { id: "raw-instance" },
      runtime: { terminalKey: "raw-instance", tmuxSessionId: "tmux-raw" },
      state: "connected",
    });
    provider = createProvider({ instanceStore: activeStore, tmuxSessionManager: inactiveManager });
    vi.spyOn(provider["sessionRuntime"], "getActiveBackend").mockReturnValue(
      "tmux",
    );
    await expect(provider.executeRawTmuxCommand("bad-command")).rejects.toThrow(
      /Unsupported tmux subcommand/i,
    );

    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined);
    await expect(provider.executeRawTmuxCommand("rename-window")).rejects.toThrow(
      /tmux command cancelled/i,
    );
  });

  it("prompts for all value-based raw tmux commands and preserves passthrough args", async () => {
    mockConfiguration();
    const activeStore = new InstanceStore();
    activeStore.upsert({
      config: { id: "raw-values" },
      runtime: { terminalKey: "raw-values", tmuxSessionId: "tmux-values" },
      state: "connected",
    });
    const executeRawCommand = vi.fn(async () => "ok");
    provider = createProvider({
      instanceStore: activeStore,
      tmuxSessionManager: { executeRawCommand } as never as TmuxSessionManager,
    });
    vi.spyOn(provider["sessionRuntime"], "getActiveBackend").mockReturnValue(
      "tmux",
    );
    vi.mocked(vscode.window.showInputBox)
      .mockResolvedValueOnce("window next")
      .mockResolvedValueOnce("tiled");

    await provider.executeRawTmuxCommand("rename-window", ["old-window"]);
    await provider.executeRawTmuxCommand("select-layout", ["even-horizontal"]);
    await provider.executeRawTmuxCommand("choose-tree", ["-Z"]);

    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Rename tmux window",
        value: "old-window",
      }),
    );
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Select tmux layout",
        value: "even-horizontal",
      }),
    );
    expect(executeRawCommand).toHaveBeenNthCalledWith(1, "tmux-values", "rename-window", ["window next"]);
    expect(executeRawCommand).toHaveBeenNthCalledWith(2, "tmux-values", "select-layout", ["tiled"]);
    expect(executeRawCommand).toHaveBeenNthCalledWith(3, "tmux-values", "choose-tree", ["-Z"]);
  });

  it("skips zellij AI launch when the manager is unavailable and when no tool is resolved", async () => {
    mockConfiguration();
    provider = createProvider();
    vi.spyOn(provider["sessionRuntime"], "getActiveBackend").mockReturnValue(
      "zellij",
    );
    const warnSpy = vi.spyOn(provider["logger"], "warn");

    await provider.launchAiTool("zellij-no-manager", "codex", false);
    await provider.launchAiTool("zellij-no-tool", "missing-tool", false);

    expect(warnSpy).toHaveBeenCalledWith(
      "[TerminalProvider] launchAiTool skipped: zellij manager unavailable",
    );
  });

  it("routes remaining webview bridge callbacks through TerminalProvider", async () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);
    const runtime = provider["sessionRuntime"];
    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("zellij");
    vi.spyOn(runtime, "switchToZellijSession").mockResolvedValue(undefined);
    vi.spyOn(runtime, "switchToNativeShell").mockResolvedValue(undefined);
    vi.spyOn(runtime, "routeDroppedTextToTmuxPane").mockResolvedValue(true);
    vi.spyOn(runtime, "formatPastedImage").mockReturnValue("@image.png");
    vi.spyOn(provider, "toggleEditorAttachment").mockResolvedValue(undefined);
    const dashboardSpy = vi.spyOn(provider, "toggleDashboard");
    const restartSpy = vi.spyOn(runtime, "restart").mockImplementation(() => {});

    messageHandler({ type: "switchSession", sessionId: "zellij-route" });
    messageHandler({ type: "toggleDashboard" });
    messageHandler({ type: "toggleEditorAttachment" });
    messageHandler({ type: "requestRestart" });
    messageHandler({ type: "sendTmuxPromptChoice", choice: "shell" });
    messageHandler({ type: "filesDropped", files: ["/tmp/a.ts"], shiftKey: true, dropCell: { col: 1, row: 2 } });
    messageHandler({ type: "imagePasted", data: "data:image/png;base64,aGVsbG8=" });
    await flushAsyncStartup();

    expect(runtime.switchToZellijSession).toHaveBeenCalledWith("zellij-route");
    expect(dashboardSpy).toHaveBeenCalledTimes(1);
    expect(provider.toggleEditorAttachment).toHaveBeenCalledTimes(1);
    expect(restartSpy).toHaveBeenCalledTimes(1);
    expect(runtime.switchToNativeShell).toHaveBeenCalledTimes(1);
    expect(runtime.routeDroppedTextToTmuxPane).toHaveBeenCalledWith("'/tmp/a.ts' ", { col: 1, row: 2 });
    expect(runtime.formatPastedImage).not.toHaveBeenCalledWith("not-created");
  });

  it("routes clipboard paste and pasted images through provider bridge callbacks", async () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler, view } = resolveProvider(provider);
    const runtime = provider["sessionRuntime"];
    vi.spyOn(runtime, "formatPastedImage").mockReturnValue("@clipboard.png");
    vi.mocked(vscode.env.clipboard.readText).mockResolvedValue("clipboard text");

    messageHandler({ type: "triggerPaste" });
    messageHandler({ type: "imagePasted", data: "data:image/png;base64,aGVsbG8=" });
    await flushAsyncStartup();

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "clipboardContent",
      text: "clipboard text",
    });
    expect(runtime.formatPastedImage).toHaveBeenCalledWith(
      expect.stringContaining("opencode-clipboard-"),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "clipboardContent",
      text: "@clipboard.png",
    });
  });

  it("falls back to start when native restore record disappears during visible autostart", async () => {
    mockConfiguration({ autoStartOnOpen: true });
    const activeStore = new InstanceStore();
    activeStore.upsert({
      config: {
        id: "native-vanish",
        terminalBackend: "native",
        selectedAiTool: "opencode",
      },
      runtime: { terminalKey: "native-vanish" },
      state: "disconnected",
    });
    const getActiveSpy = vi.spyOn(activeStore, "getActive");
    getActiveSpy.mockImplementationOnce(() => ({
      config: {
        id: "native-vanish",
        terminalBackend: "native",
        selectedAiTool: "opencode",
      },
      runtime: { terminalKey: "native-vanish" },
      state: "disconnected",
    }));
    getActiveSpy.mockImplementationOnce(() => undefined as never);
    provider = createProvider({ instanceStore: activeStore });
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();

    resolveProvider(provider);
    await flushAsyncStartup();

    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("covers autostart restore fallback callbacks directly", async () => {
    mockConfiguration({ autoStartOnOpen: true });
    provider = createProvider();
    const internals = provider as unknown as {
      getNativeRestoreRecord: () => unknown;
      promptNativeRestore: () => Promise<boolean>;
    };
    vi.spyOn(internals, "getNativeRestoreRecord").mockReturnValue({});
    vi.spyOn(internals, "promptNativeRestore").mockResolvedValue(false);
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();

    resolveProvider(provider);
    await flushAsyncStartup();

    expect(startSpy).toHaveBeenCalledTimes(1);

    const view = vscode.WebviewView() as never as ReturnType<
      typeof vscode.WebviewView
    >;
    view.visible = false;
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    const visibilityListener = vi.mocked(view.onDidChangeVisibility).mock
      .calls[0]?.[0] as () => void;
    view.visible = true;
    visibilityListener();
    await flushAsyncStartup();

    expect(startSpy).toHaveBeenCalledTimes(2);
  });

  it("covers autostart restore callbacks that do not relaunch", async () => {
    mockConfiguration({ autoStartOnOpen: true });
    provider = createProvider();
    const internals = provider as unknown as {
      getNativeRestoreRecord: () => unknown;
      promptNativeRestore: () => Promise<boolean>;
      isStarted: () => boolean;
    };
    vi.spyOn(internals, "getNativeRestoreRecord").mockReturnValue({});
    vi.spyOn(internals, "promptNativeRestore").mockResolvedValue(true);
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();
    resolveProvider(provider);
    await flushAsyncStartup();
    expect(startSpy).not.toHaveBeenCalled();

    vi.spyOn(internals, "isStarted").mockReturnValue(true);
    const view = vscode.WebviewView() as never as ReturnType<
      typeof vscode.WebviewView
    >;
    view.visible = false;
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    const visibilityListener = vi.mocked(view.onDidChangeVisibility).mock
      .calls[0]?.[0] as () => void;
    view.visible = true;
    visibilityListener();
    await flushAsyncStartup();

    expect(startSpy).not.toHaveBeenCalled();
  });

  it("falls back to start when native restore record disappears on first visibility", async () => {
    mockConfiguration({ autoStartOnOpen: true });
    const activeStore = new InstanceStore();
    activeStore.upsert({
      config: {
        id: "native-hidden-vanish",
        terminalBackend: "native",
        selectedAiTool: "opencode",
      },
      runtime: { terminalKey: "native-hidden-vanish" },
      state: "disconnected",
    });
    const getActiveSpy = vi.spyOn(activeStore, "getActive");
    getActiveSpy.mockImplementationOnce(() => ({
      config: {
        id: "native-hidden-vanish",
        terminalBackend: "native",
        selectedAiTool: "opencode",
      },
      runtime: { terminalKey: "native-hidden-vanish" },
      state: "disconnected",
    }));
    getActiveSpy.mockImplementationOnce(() => undefined as never);
    provider = createProvider({ instanceStore: activeStore });
    const view = vscode.WebviewView() as never as ReturnType<
      typeof vscode.WebviewView
    >;
    view.visible = false;
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();

    provider.resolveWebviewView(view as never, {} as never, {} as never);
    const visibilityListener = vi.mocked(view.onDidChangeVisibility).mock
      .calls[0]?.[0] as () => void;
    view.visible = true;
    visibilityListener();
    await flushAsyncStartup();

    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("formats empty editor selections and falls back to terminal prompt writes", async () => {
    mockConfiguration();
    provider = createProvider();
    resolveProvider(provider);
    const runtime = provider["sessionRuntime"];
    vi.spyOn(runtime, "getApiClient").mockReturnValue(undefined);
    const writeSpy = vi.spyOn(terminalManager, "writeToTerminal");
    const editor = {
      document: { uri: { fsPath: "/workspaces/repo-a/src/empty.ts", path: "" } },
      selection: {
        isEmpty: true,
        start: { line: 10 },
        end: { line: 20 },
      },
    } as never as vscodeApi.TextEditor;
    vi.mocked(vscode.workspace.asRelativePath).mockReturnValueOnce(
      "src/empty.ts",
    );

    expect(provider.formatEditorReference(editor)).toBe("@src/empty.ts");
    await provider.sendPrompt("fallback prompt");

    expect(writeSpy).toHaveBeenCalledWith("opencode-main", "fallback prompt");
  });

  it("covers remaining TerminalProvider error and fallback branches", async () => {
    mockConfiguration({ defaultAiTool: "", aiTools: DEFAULT_AI_TOOLS });
    const throwingStore = new InstanceStore();
    vi.spyOn(throwingStore, "getActive").mockImplementation(() => {
      throw "native store down";
    });
    provider = createProvider({
      instanceStore: throwingStore,
      zellijSessionManager: {
        selectPane: vi.fn(async () => undefined),
        sendTextToPane: vi.fn(async () => undefined),
      },
    });
    const runtime = provider["sessionRuntime"];
    const logger = provider["logger"];
    vi.spyOn(logger, "info");
    vi.spyOn(logger, "warn");
    resolveProvider(provider);

    const apiClient = { appendPrompt: vi.fn(async () => { throw "http down"; }) };
    vi.spyOn(runtime, "getApiClient").mockReturnValue(
      apiClient as never as ReturnType<typeof runtime.getApiClient>,
    );
    vi.spyOn(runtime, "isHttpAvailable").mockReturnValue(true);
    await provider.sendPrompt("prompt via fallback");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("http down"),
    );

    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("zellij");
    await provider.launchAiTool("zellij-pane", "codex", false, "pane-1");
    expect(provider["zellijSessionManager"]?.selectPane).toHaveBeenCalledWith(
      "pane-1",
    );

    const zellijManager = provider["zellijSessionManager"] as unknown as {
      sendTextToPane: ReturnType<typeof vi.fn>;
    };
    vi.mocked(zellijManager.sendTextToPane).mockRejectedValueOnce("launch down");
    await provider.launchAiTool("zellij-pane", "codex", false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("launch down"),
    );

  });

  it("covers visible and hidden autostart skip branches", () => {
    mockConfiguration({ autoStartOnOpen: true });
    provider = createProvider();
    vi.spyOn(
      provider as unknown as { isStarted: () => boolean },
      "isStarted",
    ).mockReturnValue(true);
    resolveProvider(provider);

    const hiddenView = vscode.WebviewView() as never as ReturnType<
      typeof vscode.WebviewView
    >;
    hiddenView.visible = false;
    provider.resolveWebviewView(hiddenView as never, {} as never, {} as never);
    const visibilityListener = vi.mocked(hiddenView.onDidChangeVisibility).mock
      .calls[0]?.[0] as () => void;
    visibilityListener();

    expect(provider["sessionRuntime"].isStartedFlag()).toBe(false);
  });

  it("covers hidden autostart fallback and disposes its visibility listener", () => {
    mockConfiguration({ autoStartOnOpen: true });
    provider = createProvider();
    const view = vscode.WebviewView() as never as ReturnType<typeof vscode.WebviewView>;
    view.visible = false;
    const startSpy = vi.spyOn(provider, "startOpenCode").mockResolvedValue();

    provider.resolveWebviewView(view as never, {} as never, {} as never);
    const visibilityDisposable = vi.mocked(view.onDidChangeVisibility).mock.results[0]?.value;
    const visibilityListener = vi.mocked(view.onDidChangeVisibility).mock.calls[0]?.[0] as () => void;
    const disposeListener = vi.mocked(view.onDidDispose).mock.calls[0]?.[0] as () => void;

    view.visible = true;
    visibilityListener();
    disposeListener();

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(visibilityDisposable.dispose).toHaveBeenCalledTimes(2);
  });

  it("validates raw tmux prompt input and resets stale editor panels", async () => {
    mockConfiguration();
    const activeStore = new InstanceStore();
    activeStore.upsert({
      config: { id: "raw-validate" },
      runtime: { terminalKey: "raw-validate", tmuxSessionId: "tmux-validate" },
      state: "connected",
    });
    const executeRawCommand = vi.fn(async () => "ok");
    provider = createProvider({
      instanceStore: activeStore,
      tmuxSessionManager: { executeRawCommand } as never as TmuxSessionManager,
    });
    vi.spyOn(provider["sessionRuntime"], "getActiveBackend").mockReturnValue("tmux");
    vi.mocked(vscode.window.showInputBox).mockImplementationOnce(async (options) => {
      expect(options?.validateInput?.("   ")).toBe("A value is required");
      expect(options?.validateInput?.(" ok ")).toBeUndefined();
      return "validated";
    });
    await provider.executeRawTmuxCommand("rename-session", ["old"]);

    const runtime = provider["sessionRuntime"];
    const writeSpy = vi.spyOn(terminalManager, "writeToTerminal");
    vi.spyOn(runtime, "hasLiveTerminalProcess").mockReturnValue(false);
    vi.spyOn(runtime, "isStartedFlag").mockReturnValue(true);
    const resetSpy = vi.spyOn(runtime, "resetState");
    const panel = (vscode.window.createWebviewPanel as unknown as () => ReturnType<typeof vscode.window.createWebviewPanel>)();
    await provider.deserializeWebviewPanel(panel as never, undefined);
    const panelMessageHandler = vi.mocked(panel.webview.onDidReceiveMessage).mock.calls[0]?.[0] as (message: unknown) => void;
    panelMessageHandler({ type: "terminalInput", data: "ls\n" });

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith("ulw-editor-1", "ls\n");
  });

  describe("multi-pane backend integration", () => {
    it("isMultiPaneSupportedBackend returns true for all backends", () => {
      mockConfiguration();
      provider = createProvider();
      const runtime = provider["sessionRuntime"];

      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("native");
      expect(provider["isMultiPaneSupportedBackend"]()).toBe(true);

      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("tmux");
      expect(provider["isMultiPaneSupportedBackend"]()).toBe(true);

      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("zellij");
      expect(provider["isMultiPaneSupportedBackend"]()).toBe(true);
    });

    it("handlePaneCreate with tmux active backend creates session with tmux backend and syncs pane", async () => {
      mockConfiguration();
      const tmuxPaneSyncService = {
        splitPane: vi.fn().mockResolvedValue("%1"),
      };
      provider = createProvider({ tmuxPaneSyncService: tmuxPaneSyncService as any });
      const runtime = provider["sessionRuntime"];
      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("tmux");
      vi.spyOn(runtime, "getSelectedTmuxSessionId").mockReturnValue("tmux-session-1");
      vi.spyOn(runtime, "getSession").mockImplementation((paneId) => {
        if (paneId === "default") {
          return { tmuxSessionId: "tmux-session-1" } as any;
        }
        return undefined;
      });
      const createSessionSpy = vi.spyOn(runtime, "createSession").mockResolvedValue(undefined);

      const { messageHandler } = resolveProvider(provider);
      await messageHandler({
        type: "paneCreate",
        paneId: "pane-2",
        direction: "vertical",
      });

      expect(createSessionSpy).toHaveBeenCalledWith("pane-2", expect.objectContaining({
        backend: "tmux",
        backendConfig: expect.objectContaining({
          tmux: expect.objectContaining({ sessionId: "tmux-session-1" }),
        }),
      }));
      expect(tmuxPaneSyncService.splitPane).toHaveBeenCalledWith("tmux-session-1", "vertical");
    });

    it("handlePaneDelete with tmux backend calls destroySession", async () => {
      mockConfiguration();
      provider = createProvider();
      const runtime = provider["sessionRuntime"];
      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("tmux");
      const destroySessionSpy = vi.spyOn(runtime, "destroySession").mockImplementation(() => {});

      const { messageHandler } = resolveProvider(provider);
      messageHandler({ type: "paneDelete", paneId: "pane-2" });

      expect(destroySessionSpy).toHaveBeenCalledWith("pane-2");
    });
  });
});
