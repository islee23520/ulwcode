import * as fs from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "../test/mocks/vscode";
import { TmuxSessionManager } from "../services/TmuxSessionManager";
import { TerminalDashboardProvider } from "./TerminalDashboardProvider";

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
  },
  readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
}));

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

describe("TerminalDashboardProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscode.workspace.workspaceFolders = [
      {
        uri: {
          fsPath: "/workspaces/repo-a",
        },
      },
    ];
  });

  async function flushPromises(): Promise<void> {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve();
    }
  }

  function createProvider(options?: {
    discoverSessions?: ReturnType<typeof vi.fn>;
    listPanes?: ReturnType<typeof vi.fn>;
    listWindows?: ReturnType<typeof vi.fn>;
    listWindowPaneGeometry?: ReturnType<typeof vi.fn>;
    zellijDiscoverSessions?: ReturnType<typeof vi.fn>;
    zellijListPanes?: ReturnType<typeof vi.fn>;
    zellijListTabs?: ReturnType<typeof vi.fn>;
    zellijSwitchSession?: ReturnType<typeof vi.fn>;
    instanceStore?: {
      getAll: ReturnType<typeof vi.fn>;
      getActive?: ReturnType<typeof vi.fn>;
      get?: ReturnType<typeof vi.fn>;
      upsert?: ReturnType<typeof vi.fn>;
      setActive?: ReturnType<typeof vi.fn>;
    };
    terminalProvider?: {
      launchDefaultAiTool: ReturnType<typeof vi.fn>;
      launchAiTool: ReturnType<typeof vi.fn>;
      switchToZellijSession?: ReturnType<typeof vi.fn>;
      killTmuxSession?: ReturnType<typeof vi.fn>;
    };
    threadHistoryStore?: {
      record: ReturnType<typeof vi.fn>;
      listActive: ReturnType<typeof vi.fn>;
      groupByProject: ReturnType<typeof vi.fn>;
      groupByTimeBucket: ReturnType<typeof vi.fn>;
      archive: ReturnType<typeof vi.fn>;
      restore: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      complete: ReturnType<typeof vi.fn>;
      completeUnobserved: ReturnType<typeof vi.fn>;
      removeTerminal: ReturnType<typeof vi.fn>;
    };
    logger?: {
      debug: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    };
  }) {
    const discoverSessions =
      options?.discoverSessions ?? vi.fn().mockResolvedValue([]);
    const listPanes = options?.listPanes ?? vi.fn().mockResolvedValue([]);
    const listWindows = options?.listWindows ?? vi.fn().mockResolvedValue([]);
    const listWindowPaneGeometry =
      options?.listWindowPaneGeometry ?? vi.fn().mockResolvedValue([]);
    const instanceStore = options?.instanceStore;
    const terminalProvider = options?.terminalProvider;
    const threadHistoryStore = options?.threadHistoryStore;
    const zellijDiscoverSessions = options?.zellijDiscoverSessions;
    const zellijListPanes = options?.zellijListPanes ?? vi.fn().mockResolvedValue([]);
    const zellijListTabs = options?.zellijListTabs ?? vi.fn().mockResolvedValue([]);
    const zellijSwitchSession =
      options?.zellijSwitchSession ?? vi.fn().mockResolvedValue(undefined);
    const logger =
      options?.logger ??
      ({
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as const);
    const context = new vscode.ExtensionContext();
    const onPaneChangedEvent = new vscode.EventEmitter<void>();
    const tmuxSessionManager = {
      discoverSessions,
      listPanes,
      listWindows,
      listWindowPaneGeometry,
      selectPane: vi.fn().mockResolvedValue(undefined),
      splitPane: vi.fn().mockResolvedValue("%8"),
      createWindow: vi.fn().mockResolvedValue({ windowId: "@1", paneId: "%8" }),
      captureSessionPreview: vi.fn().mockResolvedValue(""),
      nextWindow: vi.fn().mockResolvedValue(undefined),
      prevWindow: vi.fn().mockResolvedValue(undefined),
      killWindow: vi.fn().mockResolvedValue(undefined),
      selectWindow: vi.fn().mockResolvedValue(undefined),
      killPane: vi.fn().mockResolvedValue(undefined),
      resizePane: vi.fn().mockResolvedValue(undefined),
      swapPanes: vi.fn().mockResolvedValue(undefined),
      listPaneDtos: vi.fn().mockResolvedValue([]),
      onPaneChanged: onPaneChangedEvent.event,
    } as unknown as TmuxSessionManager;
    const zellijSessionManager = zellijDiscoverSessions
      ? {
          discoverSessions: zellijDiscoverSessions,
          listPanes: zellijListPanes,
          listTabs: zellijListTabs,
          createTab: vi.fn().mockResolvedValue(undefined),
          nextTab: vi.fn().mockResolvedValue(undefined),
          prevTab: vi.fn().mockResolvedValue(undefined),
          killTab: vi.fn().mockResolvedValue(undefined),
          selectTab: vi.fn().mockResolvedValue(undefined),
          selectPane: vi.fn().mockResolvedValue(undefined),
          splitPane: vi.fn().mockResolvedValue("terminal_8"),
          killPane: vi.fn().mockResolvedValue(undefined),
          resizePane: vi.fn().mockResolvedValue(undefined),
          switchSession: zellijSwitchSession,
        }
      : undefined;

    return {
      discoverSessions,
      listPanes,
      listWindows,
      listWindowPaneGeometry,
      zellijListPanes,
      zellijListTabs,
      zellijSwitchSession,
      logger,
      instanceStore,
      terminalProvider,
      onPaneChangedEvent,
      tmuxSessionManager,
      zellijSessionManager,
      provider: new TerminalDashboardProvider(
        context as never,
        tmuxSessionManager,
        logger as never,
        instanceStore as never,
        terminalProvider as never,
        zellijSessionManager as never,
        threadHistoryStore as never,
      ),
    };
  }

  function resolveProvider(provider: TerminalDashboardProvider) {
    const view = vscode.WebviewView();
    provider.resolveWebviewView(view as never, {} as never, {} as never);
    const messageCalls = vi.mocked(view.webview.onDidReceiveMessage).mock
      .calls as unknown[][];
    const messageHandler = (messageCalls[0]?.[0] ??
      (() =>
        Promise.reject(new Error("missing message handler")))) as unknown as (
      message: unknown,
    ) => Promise<void>;

    return { view, messageHandler };
  }

  function showProvider(provider: TerminalDashboardProvider) {
    const panel = {
      webview: {
        options: {},
        html: "",
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
        postMessage: vi.fn(),
        asWebviewUri: vi.fn((uri: { path?: string; fsPath?: string }) => ({
          toString: () => uri.path ?? uri.fsPath ?? "",
        })),
        cspSource: "",
      },
      visible: true,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      reveal: vi.fn(),
      dispose: vi.fn(),
    };
    vi.mocked(vscode.window.createWebviewPanel).mockImplementationOnce(
      () => panel as never,
    );
    provider.show();
    const messageCalls = vi.mocked(panel.webview.onDidReceiveMessage).mock
      .calls as unknown[][];
    const messageHandler = (messageCalls[0]?.[0] ??
      (() =>
        Promise.reject(new Error("missing message handler")))) as unknown as (
      message: unknown,
    ) => Promise<void>;

    return { panel, messageHandler };
  }

  it("posts workspace-filtered tmux sessions to the dashboard webview", async () => {
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([
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
      ]),
    });

    const { view } = resolveProvider(provider);
    await flushPromises();

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "updateTmuxSessions",
        workspace: "repo-a",
        sessions: [
          {
            id: "repo-a",
            name: "repo-a",
            workspace: "repo-a",
            workspaceUri: "file:///workspaces/repo-a",
            isActive: true,
            paneCount: 0,
          },
        ],
        nativeShells: [],
        panes: {
          "repo-a": [],
        },
        windows: {
          "repo-a": [],
        },
      }),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "opencode",
            label: "OpenCode",
            args: ["-c"],
          }),
          expect.objectContaining({
            name: "claude",
            label: "Claude Code",
          }),
          expect.objectContaining({
            name: "codex",
            label: "Codex",
          }),
        ]),
      }),
    );
  });

  it("records open dashboard sessions as thread history and posts project history", async () => {
    const threadHistoryStore = {
      record: vi.fn().mockResolvedValue(undefined),
      listActive: vi.fn().mockReturnValue([
        {
          id: "repo-a",
          kind: "agent",
          title: "repo-a",
          sessionId: "repo-a",
          workspaceName: "repo-a",
          workspaceUri: "file:///workspaces/repo-a",
          createdAt: "2026-06-02T08:00:00.000Z",
          updatedAt: "2026-06-02T09:00:00.000Z",
          status: "running",
        },
      ]),
      groupByProject: vi.fn().mockReturnValue([
        {
          workspaceName: "repo-a",
          workspaceUri: "file:///workspaces/repo-a",
          entries: [
            {
              id: "repo-a",
              kind: "agent",
              title: "repo-a",
              sessionId: "repo-a",
              workspaceName: "repo-a",
              workspaceUri: "file:///workspaces/repo-a",
              createdAt: "2026-06-02T08:00:00.000Z",
              updatedAt: "2026-06-02T09:00:00.000Z",
              status: "running",
            },
          ],
        },
      ]),
      groupByTimeBucket: vi.fn().mockReturnValue([]),
      archive: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      completeUnobserved: vi.fn().mockResolvedValue(undefined),
      removeTerminal: vi.fn().mockResolvedValue(undefined),
    };
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([
        {
          id: "repo-a",
          name: "repo-a",
          workspace: "repo-a",
          isActive: true,
        },
        {
          id: "repo-a-background",
          name: "repo-a-background",
          workspace: "repo-a",
          isActive: false,
        },
      ]),
      threadHistoryStore,
    });

    const { view } = resolveProvider(provider);
    await flushPromises();
    await flushPromises();

    expect(threadHistoryStore.record).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "repo-a",
        kind: "agent",
        sessionId: "repo-a",
        workspaceUri: "file:///workspaces/repo-a",
        status: "running",
      }),
    );
    expect(threadHistoryStore.record).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "repo-a-background",
        kind: "agent",
        status: "running",
      }),
    );
    expect(threadHistoryStore.completeUnobserved).toHaveBeenCalledWith(
      expect.any(Set),
      "file:///workspaces/repo-a",
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadHistory: expect.objectContaining({
          projects: [
            expect.objectContaining({
              workspaceName: "repo-a",
            }),
          ],
        }),
      }),
    );
  });

  it("routes thread history archive restore and delete actions", async () => {
    const threadHistoryStore = {
      record: vi.fn().mockResolvedValue(undefined),
      listActive: vi.fn().mockReturnValue([]),
      groupByProject: vi.fn().mockReturnValue([]),
      groupByTimeBucket: vi.fn().mockReturnValue([]),
      archive: vi.fn().mockResolvedValue(undefined),
      restore: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      completeUnobserved: vi.fn().mockResolvedValue(undefined),
      removeTerminal: vi.fn().mockResolvedValue(undefined),
    };
    const { provider } = createProvider({ threadHistoryStore });
    const { messageHandler } = resolveProvider(provider);
    await flushPromises();

    await messageHandler({ action: "archiveThread", threadId: "thread-a" });
    await messageHandler({ action: "restoreThread", threadId: "thread-a" });
    await messageHandler({ action: "deleteThread", threadId: "thread-a" });

    expect(threadHistoryStore.archive).toHaveBeenCalledWith("thread-a");
    expect(threadHistoryStore.restore).toHaveBeenCalledWith("thread-a");
    expect(threadHistoryStore.delete).toHaveBeenCalledWith("thread-a");
  });

  it("filters sessions by workspace URI when same-named project folders exist", async () => {
    vscode.workspace.workspaceFolders = [
      { uri: vscode.Uri.file("/workspaces/alpha/repo") },
    ];
    const instanceStore = {
      getAll: vi.fn().mockReturnValue([
        {
          config: {
            id: "alpha-record",
            workspaceUri: "file:///workspaces/alpha/repo",
          },
          runtime: { tmuxSessionId: "repo-alpha" },
          state: "connected",
        },
        {
          config: {
            id: "beta-record",
            workspaceUri: "file:///workspaces/beta/repo",
          },
          runtime: { tmuxSessionId: "repo-beta" },
          state: "connected",
        },
      ]),
      getActive: vi.fn().mockReturnValue({
        config: { id: "alpha-record" },
      }),
      get: vi.fn(),
      upsert: vi.fn(),
      setActive: vi.fn(),
    };
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([
        {
          id: "repo-alpha",
          name: "repo-alpha",
          workspace: "repo",
          isActive: true,
        },
        {
          id: "repo-beta",
          name: "repo-beta",
          workspace: "repo",
          isActive: false,
        },
      ]),
      instanceStore,
    });

    const { view } = resolveProvider(provider);
    await flushPromises();

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: [
          expect.objectContaining({
            id: "repo-alpha",
            workspace: "repo",
            workspaceUri: "file:///workspaces/alpha/repo",
          }),
        ],
      }),
    );
  });

  it("posts zellij sessions with tabs mapped to dashboard windows", async () => {
    const { provider, zellijListPanes, zellijListTabs } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      zellijDiscoverSessions: vi.fn().mockResolvedValue([
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
      ]),
      zellijListTabs: vi.fn().mockResolvedValue([
        { index: 1, name: "editor", isActive: true },
        { index: 2, name: "tests", isActive: false },
      ]),
      zellijListPanes: vi.fn().mockResolvedValue([
        {
          id: "terminal_1",
          title: "shell",
          isFocused: true,
          isFloating: false,
        },
      ]),
    });

    const { view } = resolveProvider(provider);
    await flushPromises();

    expect(zellijListTabs).toHaveBeenCalledTimes(1);
    expect(zellijListPanes).toHaveBeenCalledTimes(1);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: [
          {
            id: "repo-a",
            name: "Zellij: repo-a",
            workspace: "repo-a",
            workspaceUri: "file:///workspaces/repo-a",
            isActive: true,
            paneCount: 1,
          },
        ],
        panes: {
          "repo-a": [
            expect.objectContaining({
              paneId: "terminal_1",
              isActive: true,
              windowId: "zellij-tab-1",
            }),
          ],
        },
        windows: {
          "repo-a": [
            expect.objectContaining({
              windowId: "zellij-tab-1",
              name: "Tab: editor",
              panes: [expect.objectContaining({ paneId: "terminal_1" })],
            }),
            expect.objectContaining({
              windowId: "zellij-tab-2",
              name: "Tab: tests",
            }),
          ],
        },
      }),
    );
  });

  it("routes activate/create/native actions through commands and refreshes", async () => {
    const { provider, discoverSessions } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([
        {
          id: "repo-a",
          name: "repo-a",
          workspace: "repo-a",
          isActive: false,
        },
      ]),
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({
      action: "activate",
      sessionId: "repo-a",
      workspaceUri: "file:///workspaces/repo-a",
    });
    await messageHandler({ action: "create" });
    await messageHandler({ action: "switchNativeShell" });
    await flushPromises();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.openSessionInNewWindow",
      {
        sessionId: "repo-a",
        backend: "tmux",
        workspaceUri: "file:///workspaces/repo-a",
        label: "repo-a (tmux)",
      },
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.createTmuxSession",
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.switchNativeShell",
    );
    expect(discoverSessions).toHaveBeenCalledTimes(4);
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "updateTmuxSessions",
        workspace: "repo-a",
        sessions: [
          {
            id: "repo-a",
            name: "repo-a",
            workspace: "repo-a",
            workspaceUri: "file:///workspaces/repo-a",
            isActive: false,
            paneCount: 0,
          },
        ],
        nativeShells: [],
        panes: {
          "repo-a": [],
        },
        windows: {
          "repo-a": [],
        },
      }),
    );
  });

  it("refreshes sessions when the refresh action is received", async () => {
    const { provider, discoverSessions } = createProvider();
    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({ action: "refresh" });

    expect(discoverSessions).toHaveBeenCalledTimes(2);
    expect(view.webview.postMessage).toHaveBeenCalledTimes(1);
  });

  it("passes the pane window id when switching panes from another window", async () => {
    const { provider, tmuxSessionManager } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([
        {
          id: "repo-a",
          name: "repo-a",
          workspace: "repo-a",
          isActive: true,
        },
      ]),
    });
    const selectPane = vi.mocked(tmuxSessionManager.selectPane);
    const messageHandler = (
      provider as unknown as {
        handleWebviewMessage: (message: unknown) => Promise<void>;
      }
    ).handleWebviewMessage.bind(provider);

    await messageHandler({
      action: "switchPane",
      sessionId: "repo-a",
      paneId: "%3",
      windowId: "@2",
    });

    expect(selectPane).toHaveBeenCalledWith("%3", "@2");
  });

  it("uses the active pane cwd when splitting from the dashboard", async () => {
    const discoverSessions = vi.fn().mockResolvedValue([
      {
        id: "repo-a",
        name: "repo-a",
        workspace: "repo-a",
        isActive: true,
      },
    ]);
    const listPanes = vi.fn().mockResolvedValue([
      {
        paneId: "%7",
        index: 0,
        title: "shell",
        isActive: true,
        currentPath: "/workspaces/repo-a/packages/app",
      },
    ]);
    const listWindows = vi.fn().mockResolvedValue([]);
    const { provider, tmuxSessionManager } = createProvider({
      discoverSessions,
      listPanes,
      listWindows,
    });
    const splitPane = vi.mocked(tmuxSessionManager.splitPane);
    splitPane.mockResolvedValue("%8");
    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({
      action: "splitPane",
      sessionId: "repo-a",
      direction: "h",
    });

    expect(splitPane).toHaveBeenCalledWith("%7", "h", {
      workingDirectory: "/workspaces/repo-a/packages/app",
    });
  });

  it("launches the default AI tool when the dashboard sends an explicit action", async () => {
    const terminalProvider = {
      launchDefaultAiTool: vi.fn().mockResolvedValue(undefined),
      launchAiTool: vi.fn(),
    };
    const { provider } = createProvider({
      discoverSessions: vi
        .fn()
        .mockResolvedValue([
          { id: "repo-a", name: "Repo A", workspace: "repo-a", isActive: true },
        ]),
      listPanes: vi.fn().mockResolvedValue([
        {
          paneId: "%1",
          index: 0,
          title: "active",
          isActive: true,
          currentPath: "/workspaces/repo-a",
        },
      ]),
      terminalProvider,
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({
      action: "launchDefaultAiTool",
      sessionId: "repo-a",
      sessionName: "Repo A",
    });

    expect(terminalProvider.launchDefaultAiTool).toHaveBeenCalledWith(
      "repo-a",
      "%1",
    );
    expect(view.webview.postMessage).not.toHaveBeenCalled();
  });

  it("does not auto-launch the default AI tool after dashboard create, createWindow, or splitPane actions", async () => {
    const discoverSessions = vi
      .fn()
      .mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]);
    const listPanes = vi.fn().mockResolvedValue([
      {
        paneId: "%7",
        index: 0,
        title: "shell",
        isActive: true,
        currentPath: "/workspaces/repo-a/packages/app",
      },
    ]);
    const { provider, tmuxSessionManager } = createProvider({
      discoverSessions,
      listPanes,
      listWindows: vi.fn().mockResolvedValue([]),
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({ action: "create" });
    await flushPromises();
    await messageHandler({ action: "createWindow", sessionId: "repo-a" });
    await flushPromises();
    await messageHandler({
      action: "splitPane",
      sessionId: "repo-a",
      direction: "h",
    });
    await flushPromises();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.createTmuxSession",
    );
    expect(vi.mocked(tmuxSessionManager.createWindow)).toHaveBeenCalledWith(
      "repo-a",
      "/workspaces/repo-a/packages/app",
    );
    expect(vi.mocked(tmuxSessionManager.splitPane)).toHaveBeenCalledWith(
      "%7",
      "h",
      {
        workingDirectory: "/workspaces/repo-a/packages/app",
      },
    );
    expect(view.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "launchDefaultAiTool" }),
    );
  });

  it("opens the dashboard as a webview panel and reveals existing panel", async () => {
    const { provider } = createProvider();

    provider.show();
    provider.show();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      "ulw.terminalDashboard",
      "ULW Terminal Manager",
      {
        preserveFocus: true,
        viewColumn: vscode.ViewColumn.Beside,
      },
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
    );

    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as ReturnType<typeof vscode.window.createWebviewPanel>;

    expect(panel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.Beside, true);
  });

  it("posts workspace-filtered tmux sessions to the panel webview", async () => {
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([
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
      ]),
    });

    const { panel } = showProvider(provider);
    await flushPromises();

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "updateTmuxSessions",
        workspace: "repo-a",
        sessions: [
          {
            id: "repo-a",
            name: "repo-a",
            workspace: "repo-a",
            workspaceUri: "file:///workspaces/repo-a",
            isActive: true,
            paneCount: 0,
          },
        ],
      }),
    );
  });

  it("renders versioned dashboard html and replaces template placeholders", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      [
        "{{CSP_SOURCE}}",
        "{{NONCE}}",
        "{{SCRIPT_URI}}",
        "{{CSS_URI}}",
        "{{HTML_VERSION}}",
      ].join("|"),
    );
    const { provider } = createProvider();

    const { view } = resolveProvider(provider);

    expect(view.webview.html).toContain("default-src 'none'");
    expect(view.webview.html).toContain("?v=16");
    expect(view.webview.html).toContain("16");
    expect(view.webview.html).not.toContain("{{SCRIPT_URI}}");
    expect(view.webview.html).not.toContain("{{CSS_URI}}");
    expect(view.webview.html).not.toContain("{{NONCE}}");
    expect(fs.readFileSync).toHaveBeenCalledWith(
      "/test/extension/dist/dashboard.html",
      "utf-8",
    );
  });

  it("queues failed webview updates and flushes them when the view becomes visible again", async () => {
    const discoverSessions = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ])
      .mockResolvedValueOnce([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
        { id: "repo-b", name: "repo-b", workspace: "repo-b", isActive: false },
      ])
      .mockResolvedValueOnce([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
        { id: "repo-b", name: "repo-b", workspace: "repo-b", isActive: false },
      ]);
    const { provider, logger } = createProvider({ discoverSessions });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();

    vi.mocked(view.webview.postMessage)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    await messageHandler({ action: "toggleScope" });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("postMessage returned false"),
    );

    const visibilityHandler = vi.mocked(view.onDidChangeVisibility).mock
      .calls[0]?.[0] as () => void;
    view.visible = true;
    visibilityHandler();
    await flushPromises();

    expect(vi.mocked(view.webview.postMessage)).toHaveBeenCalledTimes(4);
    expect(discoverSessions).toHaveBeenCalledTimes(3);
  });

  it("falls back to an unavailable payload when session discovery fails", async () => {
    const { provider, logger } = createProvider({
      discoverSessions: vi.fn().mockRejectedValue(new Error("tmux down")),
    });

    const { view } = resolveProvider(provider);
    await flushPromises();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load tmux sessions: tmux down"),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "updateTmuxSessions",
      sessions: [],
      nativeShells: [],
      workspace: "No workspace",
      panes: {},
      tmuxAvailable: false,
    });
  });

  it("refreshes when pane changes are emitted by tmux", async () => {
    const { provider, discoverSessions, onPaneChangedEvent } = createProvider({
      discoverSessions: vi
        .fn()
        .mockResolvedValue([
          { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
        ]),
    });

    resolveProvider(provider);
    await flushPromises();
    expect(discoverSessions).toHaveBeenCalledTimes(1);

    onPaneChangedEvent.fire();
    await flushPromises();

    expect(discoverSessions).toHaveBeenCalledTimes(2);
  });

  it("creates, activates, filters, and kills native shells through the dashboard", async () => {
    const instanceStore = {
      getAll: vi
        .fn()
        .mockReturnValueOnce([
          {
            config: {
              id: "shell-1",
              label: "Shell 1",
              workspaceUri: "file:///workspaces/repo-a",
            },
            runtime: {},
            state: "connected",
          },
          {
            config: {
              id: "tmux-1",
              label: "tmux",
              workspaceUri: "file:///workspaces/repo-a",
            },
            runtime: { tmuxSessionId: "repo-a" },
            state: "connected",
          },
        ])
        .mockReturnValue([
          {
            config: {
              id: "shell-1",
              label: "Shell 1",
              workspaceUri: "file:///workspaces/repo-a",
            },
            runtime: {},
            state: "connected",
          },
          {
            config: {
              id: "shell-2",
              label: "Shell 2",
              workspaceUri: "file:///workspaces/repo-b",
            },
            runtime: {},
            state: "disconnected",
          },
          {
            config: {
              id: "tmux-1",
              label: "tmux",
              workspaceUri: "file:///workspaces/repo-a",
            },
            runtime: { tmuxSessionId: "repo-a" },
            state: "connected",
          },
        ]),
      getActive: vi.fn().mockReturnValue({
        config: { id: "shell-1" },
      }),
      get: vi.fn(),
      upsert: vi.fn(),
      setActive: vi.fn(),
    };
    const { provider } = createProvider({
      discoverSessions: vi
        .fn()
        .mockResolvedValue([
          { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
        ]),
      instanceStore,
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeShells: [
          {
            id: "shell-1",
            label: "Shell 1",
            workspaceUri: "file:///workspaces/repo-a",
            state: "connected",
            isActive: true,
          },
        ],
      }),
    );

    await messageHandler({ action: "createNativeShell" });
    await messageHandler({
      action: "activateNativeShell",
      instanceId: "shell-1",
      workspaceUri: "file:///workspaces/repo-a",
    });
    await messageHandler({ action: "killNativeShell", instanceId: "shell-1" });

    expect(instanceStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          label: expect.stringMatching(/^Shell \d+$/),
          workspaceUri: "file:///workspaces/repo-a",
        }),
        runtime: {},
        state: "disconnected",
      }),
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.openSessionInNewWindow",
      {
        sessionId: "shell-1",
        backend: "native",
        workspaceUri: "file:///workspaces/repo-a",
        label: "Shell 1",
      },
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.killNativeShell",
      "shell-1",
    );
  });

  it("silently refreshes when activating a missing native shell instance throws", async () => {
    const instanceStore = {
      getAll: vi.fn().mockReturnValue([]),
      getActive: vi.fn().mockReturnValue(undefined),
      get: vi.fn(),
      upsert: vi.fn(),
      setActive: vi.fn().mockImplementation(() => {
        throw new Error("missing");
      }),
    };
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      instanceStore,
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();
    vi.mocked(vscode.commands.executeCommand).mockClear();

    await messageHandler({
      action: "activateNativeShell",
      instanceId: "missing",
    });

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "ulw.switchNativeShell",
    );
  });

  it("warns when a native shell project activation has no workspace URI", async () => {
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      instanceStore: {
        getAll: vi.fn().mockReturnValue([]),
        getActive: vi.fn().mockReturnValue(undefined),
        get: vi.fn(),
        upsert: vi.fn(),
        setActive: vi.fn(),
      },
    });

    const { messageHandler } = resolveProvider(provider);
    await flushPromises();

    await messageHandler({
      action: "activateNativeShell",
      instanceId: "shell-1",
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "No workspace folder available",
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "ulw.openSessionInNewWindow",
      expect.anything(),
    );
  });

  it("routes pane, window, and AI launch actions through tmux and terminal services", async () => {
    const terminalProvider = {
      launchDefaultAiTool: vi.fn(),
      launchAiTool: vi.fn().mockResolvedValue(undefined),
    };
    const listPanes = vi.fn().mockResolvedValue([
      {
        paneId: "%1",
        index: 0,
        title: "shell",
        isActive: true,
        currentPath: "/workspaces/repo-a",
      },
    ]);
    const { provider, tmuxSessionManager } = createProvider({
      discoverSessions: vi
        .fn()
        .mockResolvedValue([
          { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
        ]),
      listPanes,
      terminalProvider,
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({ action: "createWindow", sessionId: "repo-a" });
    await messageHandler({ action: "nextWindow", sessionId: "repo-a" });
    await messageHandler({ action: "prevWindow", sessionId: "repo-a" });
    await messageHandler({
      action: "killWindow",
      sessionId: "repo-a",
      windowId: "@9",
    });
    await messageHandler({
      action: "selectWindow",
      sessionId: "repo-a",
      windowId: "@2",
    });
    await messageHandler({
      action: "splitPaneWithCommand",
      sessionId: "repo-a",
      paneId: "%1",
      direction: "v",
      command: "npm test",
    });
    await messageHandler({
      action: "killPane",
      sessionId: "repo-a",
      paneId: "%2",
    });
    await messageHandler({
      action: "resizePane",
      sessionId: "repo-a",
      paneId: "%2",
      direction: "L",
      amount: 5,
    });
    await messageHandler({
      action: "swapPane",
      sessionId: "repo-a",
      sourcePaneId: "%1",
      targetPaneId: "%2",
    });
    await messageHandler({
      action: "launchAiTool",
      sessionId: "repo-a",
      tool: "claude",
      savePreference: true,
    });

    expect(vi.mocked(tmuxSessionManager.createWindow)).toHaveBeenCalledWith(
      "repo-a",
      "/workspaces/repo-a",
    );
    expect(vi.mocked(tmuxSessionManager.nextWindow)).toHaveBeenCalledWith(
      "repo-a",
    );
    expect(vi.mocked(tmuxSessionManager.prevWindow)).toHaveBeenCalledWith(
      "repo-a",
    );
    expect(vi.mocked(tmuxSessionManager.killWindow)).toHaveBeenCalledWith("@9");
    expect(vi.mocked(tmuxSessionManager.selectWindow)).toHaveBeenCalledWith(
      "@2",
    );
    expect(vi.mocked(tmuxSessionManager.splitPane)).toHaveBeenCalledWith(
      "%1",
      "v",
      {
        command: "npm test",
        workingDirectory: "/workspaces/repo-a",
      },
    );
    expect(vi.mocked(tmuxSessionManager.killPane)).toHaveBeenCalledWith("%2");
    expect(vi.mocked(tmuxSessionManager.resizePane)).toHaveBeenCalledWith(
      "%2",
      "L",
      5,
    );
    expect(vi.mocked(tmuxSessionManager.swapPanes)).toHaveBeenCalledWith(
      "%1",
      "%2",
    );
    expect(terminalProvider.launchAiTool).toHaveBeenCalledWith(
      "repo-a",
      "claude",
      true,
      undefined,
      "tmux",
    );
  });

  it("routes zellij tab and pane actions through the zellij manager", async () => {
    const terminalProvider = {
      launchDefaultAiTool: vi.fn(),
      launchAiTool: vi.fn().mockResolvedValue(undefined),
      switchToZellijSession: vi.fn().mockResolvedValue(undefined),
      killTmuxSession: vi.fn().mockResolvedValue(undefined),
    };
    const { provider, zellijSessionManager } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      zellijDiscoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      zellijListPanes: vi.fn().mockResolvedValue([
        {
          id: "terminal_1",
          title: "active",
          isFocused: true,
          isFloating: false,
        },
      ]),
      zellijListTabs: vi.fn().mockResolvedValue([
        { index: 1, name: "main", isActive: true },
      ]),
      terminalProvider,
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({
      action: "activate",
      sessionId: "repo-a",
      workspaceUri: "file:///workspaces/repo-a",
    });
    await messageHandler({ action: "createWindow", sessionId: "repo-a" });
    await messageHandler({ action: "nextWindow", sessionId: "repo-a" });
    await messageHandler({ action: "prevWindow", sessionId: "repo-a" });
    await messageHandler({
      action: "selectWindow",
      sessionId: "repo-a",
      windowId: "zellij-tab-2",
    });
    await messageHandler({ action: "killWindow", sessionId: "repo-a" });
    await messageHandler({
      action: "switchPane",
      sessionId: "repo-a",
      paneId: "terminal_1",
    });
    await messageHandler({
      action: "splitPaneWithCommand",
      sessionId: "repo-a",
      paneId: "terminal_1",
      direction: "h",
      command: "npm test",
    });
    await messageHandler({
      action: "resizePane",
      sessionId: "repo-a",
      paneId: "terminal_1",
      direction: "L",
      amount: 5,
    });
    await messageHandler({
      action: "killPane",
      sessionId: "repo-a",
      paneId: "terminal_1",
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.openSessionInNewWindow",
      {
        sessionId: "repo-a",
        backend: "zellij",
        workspaceUri: "file:///workspaces/repo-a",
        label: "repo-a (zellij)",
      },
    );
    expect(zellijSessionManager?.createTab).toHaveBeenCalledWith({
      workingDirectory: "/workspaces/repo-a",
    });
    expect(zellijSessionManager?.nextTab).toHaveBeenCalled();
    expect(zellijSessionManager?.prevTab).toHaveBeenCalled();
    expect(zellijSessionManager?.selectTab).toHaveBeenCalledWith(2);
    expect(zellijSessionManager?.killTab).toHaveBeenCalled();
    expect(zellijSessionManager?.selectPane).toHaveBeenCalledWith("terminal_1");
    expect(zellijSessionManager?.splitPane).toHaveBeenCalledWith("h", {
      command: "npm test",
    });
    expect(zellijSessionManager?.resizePane).toHaveBeenCalledWith("left", 5);
    expect(zellijSessionManager?.killPane).toHaveBeenCalled();
  });

  it("switches into the zellij session before zellij actions", async () => {
    const zellijSwitchSession = vi.fn().mockResolvedValue(undefined);
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      zellijDiscoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      zellijListPanes: vi.fn().mockResolvedValue([]),
      zellijListTabs: vi.fn().mockResolvedValue([
        { index: 1, name: "main", isActive: true },
      ]),
      zellijSwitchSession,
    });

    const { messageHandler } = resolveProvider(provider);
    await flushPromises();

    await messageHandler({ action: "nextWindow", sessionId: "repo-a" });

    expect(zellijSwitchSession).toHaveBeenCalledWith("repo-a");
  });

  it("uses the active pane target when launching the default AI tool and falls back gracefully on pane lookup errors", async () => {
    const launchDefaultAiTool = vi.fn().mockResolvedValue(undefined);
    const terminalProvider = {
      launchDefaultAiTool,
      launchAiTool: vi.fn(),
    };
    const listPanes = vi
      .fn()
      .mockResolvedValueOnce([
        {
          paneId: "%9",
          index: 1,
          title: "active",
          isActive: true,
          currentPath: "/workspaces/repo-a",
        },
      ])
      .mockRejectedValueOnce(new Error("no panes"));
    const { provider } = createProvider({
      discoverSessions: vi
        .fn()
        .mockResolvedValue([
          { id: "repo-a", name: "Repo A", workspace: "repo-a", isActive: true },
        ]),
      listPanes,
      terminalProvider,
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({
      action: "launchDefaultAiTool",
      sessionId: "repo-a",
      sessionName: "Repo A",
    });
    await messageHandler({
      action: "launchDefaultAiTool",
      sessionId: "repo-a",
      sessionName: "Repo A",
    });

    expect(launchDefaultAiTool).toHaveBeenNthCalledWith(
      1,
      "repo-a",
      "%9",
    );
    expect(launchDefaultAiTool).toHaveBeenNthCalledWith(
      2,
      "repo-a",
      undefined,
    );
    expect(view.webview.postMessage).not.toHaveBeenCalled();
  });

  it("does not relaunch a detected tmux AI tool when it is already running", async () => {
    const terminalProvider = {
      launchDefaultAiTool: vi.fn(),
      launchAiTool: vi.fn().mockResolvedValue(undefined),
    };
    const { provider } = createProvider({
      discoverSessions: vi
        .fn()
        .mockResolvedValue([
          { id: "repo-a", name: "Repo A", workspace: "repo-a", isActive: true },
        ]),
      listPanes: vi.fn().mockResolvedValue([
        {
          paneId: "%9",
          index: 1,
          title: "active",
          isActive: true,
          currentCommand: "opencode",
          currentPath: "/workspaces/repo-a",
        },
      ]),
      terminalProvider,
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({
      action: "launchDefaultAiTool",
      sessionId: "repo-a",
      sessionName: "Repo A",
    });

    expect(view.webview.postMessage).not.toHaveBeenCalled();
    expect(terminalProvider.launchDefaultAiTool).not.toHaveBeenCalled();
    expect(terminalProvider.launchAiTool).not.toHaveBeenCalled();
  });

  it("does not relaunch a detected zellij AI tool when pane metadata includes it", async () => {
    const terminalProvider = {
      launchDefaultAiTool: vi.fn(),
      launchAiTool: vi.fn().mockResolvedValue(undefined),
    };
    const { provider, zellijSwitchSession } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      zellijDiscoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "Repo A", workspace: "repo-a", isActive: true },
      ]),
      zellijListPanes: vi.fn().mockResolvedValue([
        {
          id: "terminal_1",
          title: "Claude Code",
          isFocused: true,
          isFloating: false,
        },
      ]),
      zellijListTabs: vi.fn().mockResolvedValue([
        { index: 1, name: "main", isActive: true },
      ]),
      terminalProvider,
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({
      action: "launchDefaultAiTool",
      sessionId: "repo-a",
      sessionName: "Repo A",
    });

    expect(view.webview.postMessage).not.toHaveBeenCalled();
    expect(terminalProvider.launchDefaultAiTool).not.toHaveBeenCalled();
    expect(zellijSwitchSession).toHaveBeenCalledWith("repo-a");
    expect(terminalProvider.launchAiTool).not.toHaveBeenCalled();
  });

  it("launches through TerminalProvider before the dashboard webview resolves", async () => {
    const terminalProvider = {
      launchDefaultAiTool: vi.fn().mockResolvedValue(undefined),
      launchAiTool: vi.fn(),
    };
    const { provider } = createProvider({ terminalProvider });

    await provider.launchDefaultAiTool("repo-a", "%1");

    expect(terminalProvider.launchDefaultAiTool).toHaveBeenCalledWith(
      "repo-a",
      "%1",
    );
  });

  it("logs AI tool launch failures without throwing", async () => {
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const terminalProvider = {
      launchDefaultAiTool: vi.fn(),
      launchAiTool: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const { provider } = createProvider({ logger, terminalProvider });

    const { messageHandler } = resolveProvider(provider);
    await flushPromises();

    await messageHandler({
      action: "launchAiTool",
      sessionId: "repo-a",
      tool: "claude",
      savePreference: false,
      targetPaneId: "%3",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to launch AI tool: boom"),
    );
  });

  it("selects the next workspace session after killing the active tmux session", async () => {
    const discoverSessions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "repo-a-1",
          name: "repo-a-1",
          workspace: "repo-a",
          isActive: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "repo-a-1",
          name: "repo-a-1",
          workspace: "repo-a",
          isActive: true,
        },
        {
          id: "repo-a-2",
          name: "repo-a-2",
          workspace: "repo-a",
          isActive: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "repo-a-2",
          name: "repo-a-2",
          workspace: "repo-a",
          isActive: true,
        },
      ])
      .mockResolvedValue([
        {
          id: "repo-a-2",
          name: "repo-a-2",
          workspace: "repo-a",
          isActive: true,
        },
      ]);
    const { provider } = createProvider({ discoverSessions });

    await (
      provider as unknown as {
        handleWebviewMessage: (message: unknown) => Promise<void>;
      }
    ).handleWebviewMessage({ action: "killSession", sessionId: "repo-a-1" });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.killTmuxSession",
      "repo-a-1",
    );
    expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(
      2,
      "ulw.switchTmuxSession",
      expect.any(String),
    );
  });

  it("handles no-op, expand, reveal, and dispose flows safely", async () => {
    vi.useFakeTimers();
    const { provider, discoverSessions } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
    });

    const { panel, messageHandler } = showProvider(provider);
    await flushPromises();
    vi.mocked(panel.reveal).mockClear();

    await messageHandler(undefined);
    await messageHandler({ action: "expandPanes", sessionId: "repo-a" });

    vi.advanceTimersByTime(3000);
    await flushPromises();

    provider.reveal();
    provider.dispose();
    provider.dispose();

    expect(discoverSessions).toHaveBeenCalledTimes(3);
    expect(panel.reveal).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("stops polling when hidden and clears the resolved view on dispose", async () => {
    vi.useFakeTimers();
    const { provider, discoverSessions } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
    });
    const { view } = resolveProvider(provider);
    await flushPromises();

    const visibilityHandler = vi.mocked(view.onDidChangeVisibility).mock
      .calls[0]?.[0] as () => void;
    view.visible = false;
    visibilityHandler();
    vi.advanceTimersByTime(3000);
    await flushPromises();

    const disposeHandler = vi.mocked(view.onDidDispose).mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    disposeHandler?.();
    await provider.launchDefaultAiTool("repo-a", "Repo A");

    expect(discoverSessions).toHaveBeenCalledTimes(1);
    expect(view.webview.postMessage).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("clears the panel reference when a dashboard panel is disposed", async () => {
    const { provider } = createProvider();

    const { panel } = showProvider(provider);
    const disposeCalls = panel.onDidDispose.mock.calls as unknown as Array<
      [() => void]
    >;
    const disposeHandler = disposeCalls[0]?.[0] as
      | (() => void)
      | undefined;
    disposeHandler?.();
    provider.show();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it("continues posting sessions when pane or zellij discovery fails", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { provider } = createProvider({
      logger,
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      listWindows: vi.fn().mockResolvedValue([{ windowId: "@1", index: 1, name: "main", isActive: true }]),
      listWindowPaneGeometry: vi.fn().mockRejectedValue(new Error("pane down")),
      zellijDiscoverSessions: vi.fn().mockRejectedValue(new Error("zellij down")),
    });

    const { view } = resolveProvider(provider);
    await flushPromises();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to discover zellij sessions: zellij down"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load tmux panes for repo-a: pane down"),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: [expect.objectContaining({ id: "repo-a", paneCount: 0 })],
        panes: { "repo-a": [] },
        windows: { "repo-a": [] },
      }),
    );
  });

  it("uses fallback zellij window data when there are panes but no tabs", async () => {
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      zellijDiscoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      zellijListTabs: vi.fn().mockResolvedValue([]),
      zellijListPanes: vi.fn().mockResolvedValue([
        { id: "terminal_9", title: "lonely", isFocused: false },
      ]),
    });

    const { view } = resolveProvider(provider);
    await flushPromises();

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        windows: {
          "repo-a": [
            expect.objectContaining({
              windowId: "zellij-tab-1",
              name: "Tab 1",
              isActive: true,
              panes: [expect.objectContaining({ paneId: "terminal_9" })],
            }),
          ],
        },
      }),
    );
  });

  it("handles zellij backend lookup failures by falling back to tmux actions", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { provider, tmuxSessionManager } = createProvider({
      logger,
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      zellijDiscoverSessions: vi.fn().mockRejectedValue(new Error("lookup down")),
    });

    const { messageHandler } = resolveProvider(provider);
    await flushPromises();

    await messageHandler({
      action: "selectWindow",
      sessionId: "repo-a",
      windowId: "@7",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to resolve zellij session backend: lookup down"),
    );
    expect(vi.mocked(tmuxSessionManager.selectWindow)).toHaveBeenCalledWith("@7");
  });

  it("handles zellij split, swap no-op, and active-session replacement after zellij kill", async () => {
    const terminalProvider = {
      launchDefaultAiTool: vi.fn(),
      launchAiTool: vi.fn(),
      switchToZellijSession: vi.fn().mockResolvedValue(undefined),
      killTmuxSession: vi.fn().mockResolvedValue(undefined),
    };
    const discoverSessions = vi.fn().mockResolvedValue([]);
    const zellijDiscoverSessions = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "repo-a-1", name: "repo-a-1", workspace: "repo-a", isActive: true },
        { id: "repo-a-2", name: "repo-a-2", workspace: "repo-a", isActive: false },
      ])
      .mockResolvedValueOnce([
        { id: "repo-a-1", name: "repo-a-1", workspace: "repo-a", isActive: true },
        { id: "repo-a-2", name: "repo-a-2", workspace: "repo-a", isActive: false },
      ])
      .mockResolvedValueOnce([
        { id: "repo-a-1", name: "repo-a-1", workspace: "repo-a", isActive: true },
        { id: "repo-a-2", name: "repo-a-2", workspace: "repo-a", isActive: false },
      ])
      .mockResolvedValue([
        { id: "repo-a-2", name: "repo-a-2", workspace: "repo-a", isActive: true },
      ]);
    const { provider, zellijSessionManager } = createProvider({
      discoverSessions,
      zellijDiscoverSessions,
      zellijListPanes: vi.fn().mockResolvedValue([]),
      zellijListTabs: vi.fn().mockResolvedValue([{ index: 1, name: "main", isActive: true }]),
      terminalProvider,
    });

    const { messageHandler } = resolveProvider(provider);
    await flushPromises();

    await messageHandler({
      action: "splitPane",
      sessionId: "repo-a-1",
      paneId: "terminal_1",
      direction: "v",
    });
    await messageHandler({
      action: "swapPane",
      sessionId: "repo-a-1",
      sourcePaneId: "terminal_1",
      targetPaneId: "terminal_2",
    });
    zellijDiscoverSessions
      .mockReset()
      .mockResolvedValueOnce([
        { id: "repo-a-1", name: "repo-a-1", workspace: "repo-a", isActive: true },
        { id: "repo-a-2", name: "repo-a-2", workspace: "repo-a", isActive: false },
      ])
      .mockResolvedValueOnce([
        { id: "repo-a-1", name: "repo-a-1", workspace: "repo-a", isActive: true },
        { id: "repo-a-2", name: "repo-a-2", workspace: "repo-a", isActive: false },
      ])
      .mockResolvedValueOnce([
        { id: "repo-a-2", name: "repo-a-2", workspace: "repo-a", isActive: true },
      ])
      .mockResolvedValue([
        { id: "repo-a-2", name: "repo-a-2", workspace: "repo-a", isActive: true },
      ]);
    await messageHandler({ action: "killSession", sessionId: "repo-a-1" });

    expect(zellijSessionManager?.selectPane).toHaveBeenCalledWith("terminal_1");
    expect(zellijSessionManager?.splitPane).toHaveBeenCalledWith("v");
    expect(terminalProvider.killTmuxSession).toHaveBeenCalledWith("repo-a-1");
    expect(terminalProvider.switchToZellijSession).toHaveBeenCalledWith("repo-a-2");
  });

  it("builds native shell lists without workspace filtering and tolerates store failures", async () => {
    const instanceStore = {
      getActive: vi.fn().mockReturnValue({ config: { id: "shell-2" } }),
      getAll: vi
        .fn()
        .mockReturnValueOnce([])
        .mockReturnValueOnce([
          { config: { id: "shell-1", label: "Shell 1" }, runtime: {}, state: "connected" },
          { config: { id: "shell-2", label: "Shell 2", workspaceUri: "file:///other" }, runtime: {}, state: "disconnected" },
        ])
        .mockImplementationOnce(() => {
          throw new Error("store failed");
        }),
      get: vi.fn(),
      upsert: vi.fn(),
      setActive: vi.fn(),
    };
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      instanceStore,
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({ action: "toggleScope" });
    await messageHandler({ action: "refresh" });

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeShells: [
          { id: "shell-1", label: "Shell 1", state: "connected", isActive: false },
          {
            id: "shell-2",
            label: "Shell 2",
            workspaceUri: "file:///other",
            state: "disconnected",
            isActive: true,
          },
        ],
        showingAll: true,
      }),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ nativeShells: [] }),
    );
  });

  it("queues invisible post failures and flushes them when the view becomes visible", async () => {
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
    });

    const { view } = resolveProvider(provider);
    vi.mocked(view.webview.postMessage)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValue(true as never);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await (
      provider as unknown as {
        handleWebviewMessage: (message: unknown) => Promise<void>;
      }
    ).handleWebviewMessage({ action: "refresh" });

    const visibilityHandler = vi.mocked(view.onDidChangeVisibility).mock
      .calls[0]?.[0] as () => void;
    view.visible = true;
    visibilityHandler();

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "updateTmuxSessions" }),
    );
  });

  it("covers no-workspace session posting, tmux window pane fallbacks, and string errors", async () => {
    vscode.workspace.workspaceFolders = undefined;
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { provider } = createProvider({
      logger,
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "global", name: "global", workspace: "", isActive: true },
      ]),
      listWindows: vi.fn().mockResolvedValue([
        { windowId: "@1", index: 1, name: "main", isActive: true },
      ]),
      listWindowPaneGeometry: vi.fn().mockResolvedValue([]),
      instanceStore: {
        getActive: vi.fn().mockReturnValue(undefined),
        getAll: vi.fn().mockReturnValue([]),
      },
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "No workspace",
        sessions: [expect.objectContaining({ id: "global", paneCount: 0 })],
        windows: {
          global: [expect.objectContaining({ panes: [] })],
        },
      }),
    );

    vi.mocked(view.webview.postMessage).mockClear();
    await messageHandler({ action: "unknown-action" });
    expect(view.webview.postMessage).not.toHaveBeenCalled();

    const failing = createProvider({
      logger,
      discoverSessions: vi.fn().mockRejectedValue("tmux unavailable"),
    });
    const { view: failingView } = resolveProvider(failing.provider);
    await flushPromises();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to discover tmux sessions: tmux unavailable"),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load tmux sessions: tmux unavailable"),
    );
    expect(failingView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tmuxAvailable: false, sessions: [] }),
    );
  });

  it("uses zellij focused pane targets and handles missing terminal providers", async () => {
    const terminalProvider = {
      launchDefaultAiTool: vi.fn(),
      launchAiTool: vi.fn().mockResolvedValue(undefined),
    };
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      zellijDiscoverSessions: vi.fn().mockResolvedValue([
        { id: "zellij-a", name: "zellij-a", workspace: "repo-a", isActive: true },
      ]),
      zellijListPanes: vi.fn().mockResolvedValue([
        { id: "terminal_1", title: "one", isFocused: false },
        { id: "terminal_2", title: "two", isFocused: true },
      ]),
      zellijListTabs: vi.fn().mockResolvedValue([
        { index: 1, name: "main", isActive: true },
      ]),
      terminalProvider,
    });

    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();
    await messageHandler({
      action: "launchDefaultAiTool",
      sessionId: "zellij-a",
      sessionName: "Zellij A",
    });
    await messageHandler({
      action: "launchAiTool",
      sessionId: "zellij-a",
      tool: "claude",
      savePreference: true,
      targetPaneId: "terminal_2",
    });

    expect(terminalProvider.launchDefaultAiTool).toHaveBeenCalledWith(
      "zellij-a",
      "terminal_2",
    );
    expect(terminalProvider.launchAiTool).toHaveBeenCalledWith(
      "zellij-a",
      "claude",
      true,
      "terminal_2",
      "zellij",
    );

    const noTerminalProvider = createProvider();
    const { messageHandler: noTerminalHandler } = resolveProvider(
      noTerminalProvider.provider,
    );
    await flushPromises();
    await expect(
      noTerminalHandler({
        action: "launchAiTool",
        sessionId: "repo-a",
        tool: "claude",
        savePreference: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("covers tmux pane fallback targets and zellij optional pane branches", async () => {
    const { provider, tmuxSessionManager } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      listPanes: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            paneId: "%active",
            index: 0,
            title: "active",
            isActive: true,
            currentPath: "/active",
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]),
    });
    const { messageHandler } = resolveProvider(provider);
    await flushPromises();

    await messageHandler({ action: "createWindow", sessionId: "repo-a" });
    await messageHandler({
      action: "splitPane",
      sessionId: "repo-a",
      direction: "h",
    });
    await messageHandler({
      action: "splitPaneWithCommand",
      sessionId: "repo-a",
      paneId: "%missing",
      direction: "v",
      command: "pwd",
    });

    expect(vi.mocked(tmuxSessionManager.createWindow)).toHaveBeenCalledWith(
      "repo-a",
      "/workspaces/repo-a",
    );
    expect(vi.mocked(tmuxSessionManager.splitPane)).toHaveBeenCalledWith(
      "%active",
      "h",
      { workingDirectory: "/active" },
    );
    expect(vi.mocked(tmuxSessionManager.splitPane)).toHaveBeenCalledWith(
      "%missing",
      "v",
      { command: "pwd", workingDirectory: undefined },
    );

    const zellij = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      zellijDiscoverSessions: vi.fn().mockResolvedValue([
        { id: "zellij-a", name: "zellij-a", workspace: "repo-a", isActive: false },
      ]),
      zellijListPanes: vi.fn().mockResolvedValue([]),
      zellijListTabs: vi.fn().mockResolvedValue([{ index: 1, name: "main", isActive: true }]),
    });
    const { messageHandler: zellijHandler } = resolveProvider(zellij.provider);
    await flushPromises();

    await zellijHandler({ action: "splitPane", sessionId: "zellij-a", direction: "h" });
    await zellijHandler({ action: "killPane", sessionId: "zellij-a" });
    await zellijHandler({
      action: "resizePane",
      sessionId: "zellij-a",
      direction: "R",
      amount: 3,
    });

    expect(zellij.zellijSessionManager?.selectPane).not.toHaveBeenCalled();
    expect(zellij.zellijSessionManager?.splitPane).toHaveBeenCalledWith("h");
    expect(zellij.zellijSessionManager?.killPane).toHaveBeenCalled();
    expect(zellij.zellijSessionManager?.resizePane).toHaveBeenCalledWith(
      "right",
      3,
    );
  });

  it("handles create and activate native shells without an instance store", async () => {
    const { provider } = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
    });
    const { messageHandler } = resolveProvider(provider);
    await flushPromises();

    await messageHandler({ action: "createNativeShell" });
    await messageHandler({ action: "activateNativeShell", instanceId: "missing" });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.switchNativeShell",
    );
  });

  it("logs action errors with stringified non-Error values and refreshes", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { provider } = createProvider({
      logger,
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
    });
    const { view, messageHandler } = resolveProvider(provider);
    await flushPromises();
    vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce("boom");
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({
      action: "activate",
      sessionId: "repo-a",
      workspaceUri: "file:///workspaces/repo-a",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error handling "activate" action: boom'),
    );
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "updateTmuxSessions" }),
    );
  });

  it("does not attach subscriptions when there is no active webview", () => {
    const { provider } = createProvider();

    (
      provider as unknown as {
        attachCommonSubscriptions: (
          onDispose: () => void,
          registerDispose: (listener: () => void) => { dispose: () => void },
        ) => void;
      }
    ).attachCommonSubscriptions(
      vi.fn(),
      vi.fn(() => ({ dispose: vi.fn() })),
    );

    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("covers direct private fallbacks for missing zellij manager and zellij swap no-op", async () => {
    const { provider } = createProvider();

    await expect(
      (
        provider as unknown as {
          buildZellijWindowData: () => Promise<{
            panes: unknown[];
            windows: unknown[];
          }>;
        }
      ).buildZellijWindowData(),
    ).resolves.toEqual({ panes: [], windows: [] });

    const zellij = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      zellijDiscoverSessions: vi.fn().mockResolvedValue([
        { id: "zellij-a", name: "zellij-a", workspace: "repo-a", isActive: true },
      ]),
      zellijListPanes: vi.fn().mockResolvedValue([]),
      zellijListTabs: vi.fn().mockResolvedValue([{ index: 1, name: "main", isActive: true }]),
    });
    const { view, messageHandler } = resolveProvider(zellij.provider);
    await flushPromises();
    vi.mocked(view.webview.postMessage).mockClear();

    await messageHandler({
      action: "swapPane",
      sessionId: "zellij-a",
      sourcePaneId: "terminal_1",
      targetPaneId: "terminal_2",
    });

    expect(zellij.zellijSessionManager?.discoverSessions).toHaveBeenCalled();
    expect(zellij.tmuxSessionManager.swapPanes).not.toHaveBeenCalled();
    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "updateTmuxSessions" }),
    );
  });

  it("covers defensive branch variants without changing provider behavior", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const viewProvider = createProvider({ discoverSessions: vi.fn().mockResolvedValue([]) });
    const firstView = resolveProvider(viewProvider.provider).view;
    const secondView = resolveProvider(viewProvider.provider).view;
    const firstDispose = vi.mocked(firstView.onDidDispose).mock.calls[0]?.[0] as () => void;
    firstDispose();
    await viewProvider.provider.launchDefaultAiTool("repo-a", "Repo A");
    expect(secondView.webview.postMessage).not.toHaveBeenCalled();

    const panelProvider = createProvider();
    const firstPanel = showProvider(panelProvider.provider).panel;
    (
      panelProvider.provider as unknown as {
        panel: { webview: unknown; reveal: () => void };
      }
    ).panel = { webview: {}, reveal: vi.fn() };
    const panelDisposeCalls = firstPanel.onDidDispose.mock
      .calls as unknown as Array<[() => void]>;
    const panelDispose = panelDisposeCalls[0][0];
    panelDispose();
    panelProvider.provider.show();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);

    vscode.workspace.workspaceFolders = undefined;
    const nativeProvider = createProvider({ discoverSessions: vi.fn().mockResolvedValue([]) });
    const { messageHandler: nativeHandler } = resolveProvider(nativeProvider.provider);
    await flushPromises();
    await nativeHandler({ action: "createNativeShell" });

    const noZellij = createProvider({
      logger,
      discoverSessions: vi.fn().mockRejectedValue("tmux down"),
    });
    const { view: noZellijView } = resolveProvider(noZellij.provider);
    await flushPromises();
    expect(noZellijView.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tmuxAvailable: false }),
    );

    const zellijStringFailure = createProvider({
      logger,
      discoverSessions: vi.fn().mockResolvedValue([]),
      zellijDiscoverSessions: vi.fn().mockRejectedValue("zellij down"),
    });
    resolveProvider(zellijStringFailure.provider);
    await flushPromises();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to discover zellij sessions: zellij down"),
    );

    const tmuxFailsButZellijExists = createProvider({
      logger,
      discoverSessions: vi.fn().mockRejectedValue("tmux down with zellij"),
      zellijDiscoverSessions: vi.fn().mockResolvedValue([]),
    });
    resolveProvider(tmuxFailsButZellijExists.provider);
    await flushPromises();

    const paneStringFailure = createProvider({
      logger,
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      listWindows: vi.fn().mockResolvedValue([{ windowId: "@1", index: 1, name: "main", isActive: true }]),
      listWindowPaneGeometry: vi.fn().mockRejectedValue("pane string down"),
    });
    resolveProvider(paneStringFailure.provider);
    await flushPromises();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("pane string down"));

    const selectorProvider = createProvider({
      logger,
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      listPanes: vi.fn().mockResolvedValue([
        { paneId: "%1", index: 0, title: "inactive", isActive: false },
      ]),
    });
    const { messageHandler: selectorHandler } = resolveProvider(selectorProvider.provider);
    await flushPromises();
    await selectorHandler({ action: "launchDefaultAiTool", sessionId: "repo-a", sessionName: "Repo A" });

    const selectorErrorProvider = createProvider({
      logger,
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      listPanes: vi.fn().mockRejectedValue("pane lookup down"),
    });
    const { messageHandler: selectorErrorHandler } = resolveProvider(selectorErrorProvider.provider);
    await flushPromises();
    await selectorErrorHandler({ action: "launchDefaultAiTool", sessionId: "repo-a", sessionName: "Repo A" });
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("pane lookup down"));

    const splitFallbackProvider = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      listPanes: vi.fn().mockResolvedValue([]),
    });
    const { messageHandler: splitFallbackHandler } = resolveProvider(splitFallbackProvider.provider);
    await flushPromises();
    await splitFallbackHandler({ action: "splitPane", sessionId: "repo-a", direction: "h" });
    await splitFallbackHandler({ action: "splitPaneWithCommand", sessionId: "repo-a", direction: "v", command: "pwd" });
    expect(splitFallbackProvider.tmuxSessionManager.splitPane).toHaveBeenCalledWith(
      "repo-a",
      "h",
      { workingDirectory: undefined },
    );
    expect(splitFallbackProvider.tmuxSessionManager.splitPane).toHaveBeenCalledWith(
      "repo-a",
      "v",
      { command: "pwd", workingDirectory: undefined },
    );

    const zellijNoPaneProvider = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      zellijDiscoverSessions: vi.fn().mockResolvedValue([
        { id: "zellij-a", name: "zellij-a", workspace: "repo-a", isActive: true },
      ]),
      zellijListPanes: vi.fn().mockResolvedValue([]),
      zellijListTabs: vi.fn().mockResolvedValue([{ index: 1, name: "main", isActive: true }]),
    });
    const { messageHandler: zellijNoPaneHandler } = resolveProvider(zellijNoPaneProvider.provider);
    await flushPromises();
    await zellijNoPaneHandler({ action: "splitPaneWithCommand", sessionId: "zellij-a", direction: "h", command: "pwd" });

    const killProvider = createProvider({
      discoverSessions: vi
        .fn()
        .mockResolvedValueOnce([{ id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: false }])
        .mockResolvedValueOnce([{ id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true }])
        .mockResolvedValueOnce([{ id: "repo-b", name: "repo-b", workspace: "repo-b", isActive: true }])
        .mockResolvedValue([]),
    });
    const { messageHandler: killHandler } = resolveProvider(killProvider.provider);
    await flushPromises();
    await killHandler({ action: "killSession", sessionId: "repo-a" });
    await killHandler({ action: "killSession", sessionId: "repo-a" });

    const actionErrorProvider = createProvider({
      logger,
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
    });
    const { messageHandler: actionErrorHandler } = resolveProvider(actionErrorProvider.provider);
    await flushPromises();
    vi.mocked(actionErrorProvider.tmuxSessionManager.selectPane).mockRejectedValueOnce("select down");
    await actionErrorHandler({ action: "switchPane", sessionId: "repo-a", paneId: "%1" });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("select down"));
    vi.mocked(actionErrorProvider.tmuxSessionManager.selectPane).mockRejectedValueOnce(new Error("select error"));
    await actionErrorHandler({ action: "switchPane", sessionId: "repo-a", paneId: "%1" });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("select error"));

    const launchErrorProvider = createProvider({
      logger,
      terminalProvider: { launchDefaultAiTool: vi.fn(), launchAiTool: vi.fn().mockRejectedValue("launch down") },
    });
    const { messageHandler: launchErrorHandler } = resolveProvider(launchErrorProvider.provider);
    await flushPromises();
    await launchErrorHandler({ action: "launchAiTool", sessionId: "repo-a", tool: "claude", savePreference: false });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("launch down"));

    vscode.workspace.workspaceFolders = [{ uri: { fsPath: "/workspaces/repo-a" } }];
    const nativeShellProvider = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([]),
      instanceStore: {
        getActive: vi.fn().mockReturnValue(undefined),
        getAll: vi.fn().mockReturnValue([{ config: { id: "shell", label: "Shell" }, runtime: {}, state: "connected" }]),
      },
    });
    resolveProvider(nativeShellProvider.provider);
    await flushPromises();

    (
      nativeShellProvider.provider as unknown as { flushPendingMessage: () => void }
    ).flushPendingMessage();

    expect(
      (
        nativeShellProvider.provider as unknown as {
          parseZellijTabIndex: (windowId: string | undefined) => number;
        }
      ).parseZellijTabIndex(undefined),
    ).toBe(1);

    const backendStringFailure = createProvider({
      logger,
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      zellijDiscoverSessions: vi.fn().mockRejectedValue("backend string down"),
    });
    const { messageHandler: backendStringHandler } = resolveProvider(backendStringFailure.provider);
    await flushPromises();
    await backendStringHandler({ action: "activate", sessionId: "repo-a" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("backend string down"));

    const oddWindowsProvider = createProvider({
      discoverSessions: vi.fn().mockResolvedValue([
        { id: "repo-a", name: "repo-a", workspace: "repo-a", isActive: true },
      ]),
      listWindows: vi.fn().mockResolvedValue({
        map: vi
          .fn()
          .mockImplementationOnce((mapper: (value: { windowId: string }) => unknown) => [mapper({ windowId: "@1" })])
          .mockImplementationOnce((mapper: (value: { windowId: string; index: number; name: string; isActive: boolean }, index: number) => unknown) => [
            mapper({ windowId: "@1", index: 1, name: "one", isActive: true }, 0),
            mapper({ windowId: "@2", index: 2, name: "two", isActive: false }, 1),
          ]),
      }),
      listWindowPaneGeometry: vi.fn().mockResolvedValue([]),
    });
    resolveProvider(oddWindowsProvider.provider);
    await flushPromises();

    const oddSessionsProvider = createProvider();
    (
      oddSessionsProvider.provider as unknown as {
        discoverDashboardSessions: () => Promise<unknown>;
      }
    ).discoverDashboardSessions = async () => ({
      filter: () => ({
        [Symbol.iterator]: function* () {},
        map: (mapper: (session: { id: string; name: string; workspace: string; isActive: boolean; backend: string }) => unknown) => [
          mapper({ id: "ghost", name: "ghost", workspace: "repo-a", isActive: false, backend: "tmux" }),
        ],
      }),
      length: 1,
    });
    resolveProvider(oddSessionsProvider.provider);
    await flushPromises();

    const fallbackShowAllProvider = createProvider({
      discoverSessions: vi.fn().mockRejectedValue(new Error("show all fail")),
    });
    const { messageHandler: fallbackShowAllHandler } = resolveProvider(fallbackShowAllProvider.provider);
    await flushPromises();
    await fallbackShowAllHandler({ action: "toggleScope" });
  });

  it("covers synthetic dashboard payload fallbacks", async () => {
    const { provider } = createProvider();
    (
      provider as unknown as {
        discoverDashboardSessions: () => Promise<unknown>;
      }
    ).discoverDashboardSessions = async () => ({
      length: 1,
      [Symbol.iterator]: function* () {
        yield { id: "ghost", name: "ghost", workspace: "repo-a", isActive: false, backend: "tmux" };
      },
      filter: () => ({
        length: 1,
        [Symbol.iterator]: function* () {},
        map: (mapper: (session: {
          id: string;
          name: string;
          workspace: string;
          isActive: boolean;
          backend: "tmux";
        }) => unknown) => [
          mapper({
            id: "ghost",
            name: "ghost",
            workspace: "repo-a",
            isActive: false,
            backend: "tmux",
          }),
        ],
      }),
    });

    const { view } = resolveProvider(provider);
    await flushPromises();

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: [expect.objectContaining({ id: "ghost", paneCount: 0 })],
      }),
    );

    const fresh = createProvider();
    (
      fresh.provider as unknown as { flushPendingMessage: () => void }
    ).flushPendingMessage();
  });

  it("ensureZellijSession is a no-op when zellijSessionManager is not available", async () => {
    const { provider } = createProvider({ zellijDiscoverSessions: undefined });
    await (
      provider as unknown as {
        ensureZellijSession: (id: string) => Promise<void>;
      }
    ).ensureZellijSession("missing-session");
  });
});
