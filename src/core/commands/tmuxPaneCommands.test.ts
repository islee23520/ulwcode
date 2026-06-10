import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type * as vscodeTypes from "../../test/mocks/vscode";
import {
  TmuxSessionManager,
  type TmuxPane,
} from "../../services/TmuxSessionManager";
import type { TerminalProvider } from "../../providers/TerminalProvider";
import { InstanceStore } from "../../services/InstanceStore";
import {
  ZellijSessionManager,
  type ZellijPane,
  type ZellijTab,
} from "../../services/ZellijSessionManager";
import {
  registerTmuxPaneCommands,
  type TmuxPaneCommandDependencies,
} from "./tmuxPaneCommands";

const vscodeMock = await vi.importActual<typeof vscodeTypes>(
  "../../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../../test/mocks/vscode");
  return actual;
});

type RegisteredCommandHandler = (argument?: unknown) => Promise<void>;

type WindowEntry = {
  windowId: string;
  index: number;
  name: string;
  isActive: boolean;
};

type Harness = {
  deps: TmuxPaneCommandDependencies;
  tmuxManager: TmuxSessionManager;
  resolveActiveTmuxSessionId: ReturnType<
    typeof vi.fn<() => string | undefined>
  >;
  provider: TerminalProvider;
  handlers: Map<string, RegisteredCommandHandler>;
  selectPane: ReturnType<typeof vi.fn>;
  listPanes: ReturnType<typeof vi.fn>;
  splitPane: ReturnType<typeof vi.fn>;
  sendTextToPane: ReturnType<typeof vi.fn>;
  resizePane: ReturnType<typeof vi.fn>;
  swapPanes: ReturnType<typeof vi.fn>;
  killPane: ReturnType<typeof vi.fn>;
  nextWindow: ReturnType<typeof vi.fn>;
  prevWindow: ReturnType<typeof vi.fn>;
  createWindow: ReturnType<typeof vi.fn>;
  listWindows: ReturnType<typeof vi.fn>;
  killWindow: ReturnType<typeof vi.fn>;
  selectWindow: ReturnType<typeof vi.fn>;
  killSession: ReturnType<typeof vi.fn>;
};

type ZellijHarness = {
  deps: TmuxPaneCommandDependencies;
  zellijManager: ZellijSessionManager;
  handlers: Map<string, RegisteredCommandHandler>;
  selectPane: ReturnType<typeof vi.fn>;
  listPanes: ReturnType<typeof vi.fn>;
  splitPane: ReturnType<typeof vi.fn>;
  sendTextToPane: ReturnType<typeof vi.fn>;
  resizePane: ReturnType<typeof vi.fn>;
  killPane: ReturnType<typeof vi.fn>;
  nextTab: ReturnType<typeof vi.fn>;
  prevTab: ReturnType<typeof vi.fn>;
  createTab: ReturnType<typeof vi.fn>;
  listTabs: ReturnType<typeof vi.fn>;
  killTab: ReturnType<typeof vi.fn>;
  selectTab: ReturnType<typeof vi.fn>;
  killSession: ReturnType<typeof vi.fn>;
};

const defaultPanes: TmuxPane[] = [
  {
    paneId: "%1",
    index: 0,
    title: "editor",
    isActive: true,
  },
  {
    paneId: "%2",
    index: 1,
    title: "shell",
    isActive: false,
  },
];

const defaultWindows: WindowEntry[] = [
  {
    windowId: "@1",
    index: 1,
    name: "main",
    isActive: true,
  },
  {
    windowId: "@2",
    index: 2,
    name: "logs",
    isActive: false,
  },
];

const defaultZellijPanes: ZellijPane[] = [
  { id: "terminal_1", title: "editor", isFocused: true, isFloating: false },
  { id: "terminal_2", title: "shell", isFocused: false, isFloating: false },
];

const defaultZellijTabs: ZellijTab[] = [
  { index: 1, name: "main", isActive: true },
  { index: 2, name: "logs", isActive: false },
];

function createHarness(options?: {
  sessionId?: string | undefined;
  panes?: TmuxPane[];
  windows?: WindowEntry[];
}): Harness {
  const tmuxManager = new TmuxSessionManager();
  const provider = new vscodeMock.Disposable(
    () => {},
  ) as unknown as TerminalProvider;
  (provider as Record<string, unknown>).restart = vi.fn();
  const resolveActiveTmuxSessionId = vi.fn<() => string | undefined>(() =>
    options && "sessionId" in options ? options.sessionId : "session-1",
  );
  const resolveActiveTmuxFocus = vi.fn(async () =>
    resolveActiveTmuxSessionId()
      ? {
          sessionId: resolveActiveTmuxSessionId()!,
          windowId: "@1",
          paneId: "%1",
        }
      : undefined,
  );
  const panes = options?.panes ?? defaultPanes;
  const windows = options?.windows ?? defaultWindows;

  const selectPane = vi
    .spyOn(tmuxManager, "selectPane")
    .mockResolvedValue(undefined);
  const listPanes = vi.spyOn(tmuxManager, "listPanes").mockResolvedValue(panes);
  const splitPane = vi
    .spyOn(tmuxManager, "splitPane")
    .mockResolvedValue("%new");
  const sendTextToPane = vi
    .spyOn(tmuxManager, "sendTextToPane")
    .mockResolvedValue(undefined);
  const resizePane = vi
    .spyOn(tmuxManager, "resizePane")
    .mockResolvedValue(undefined);
  const swapPanes = vi
    .spyOn(tmuxManager, "swapPanes")
    .mockResolvedValue(undefined);
  const killPane = vi
    .spyOn(tmuxManager, "killPane")
    .mockResolvedValue(undefined);
  const nextWindow = vi
    .spyOn(tmuxManager, "nextWindow")
    .mockResolvedValue(undefined);
  const prevWindow = vi
    .spyOn(tmuxManager, "prevWindow")
    .mockResolvedValue(undefined);
  const createWindow = vi
    .spyOn(tmuxManager, "createWindow")
    .mockResolvedValue({ windowId: "@new", paneId: "%new" });
  const listWindows = vi
    .spyOn(tmuxManager, "listWindows")
    .mockResolvedValue(windows);
  const killWindow = vi
    .spyOn(tmuxManager, "killWindow")
    .mockResolvedValue(undefined);
  const selectWindow = vi
    .spyOn(tmuxManager, "selectWindow")
    .mockResolvedValue(undefined);
  const killSession = vi
    .spyOn(tmuxManager, "killSession")
    .mockResolvedValue(undefined);

  const deps: TmuxPaneCommandDependencies = {
    tmuxManager,
    zellijManager: undefined,
    instanceStore: undefined,
    resolveActiveTmuxSessionId,
    resolveActiveTmuxFocus,
    resolveWorkspacePath: vi.fn(() => "/test/workspace"),
    provider,
  };
  registerTmuxPaneCommands(deps);

  const handlers = new Map(
    vi
      .mocked(vscode.commands.registerCommand)
      .mock.calls.map(([id, callback]) => [
        id,
        callback as RegisteredCommandHandler,
      ]),
  );

  return {
    deps,
    tmuxManager,
    resolveActiveTmuxSessionId,
    provider,
    handlers,
    selectPane,
    listPanes,
    splitPane,
    sendTextToPane,
    resizePane,
    swapPanes,
    killPane,
    nextWindow,
    prevWindow,
    createWindow,
    listWindows,
    killWindow,
    selectWindow,
    killSession,
  };
}

function createZellijHarness(options?: {
  sessionId?: string | undefined;
  panes?: ZellijPane[];
  tabs?: ZellijTab[];
}): ZellijHarness {
  const zellijManager = new ZellijSessionManager();
  const tmuxManager = new TmuxSessionManager();
  const provider = new vscodeMock.Disposable(
    () => {},
  ) as unknown as TerminalProvider;
  const instanceStore = new InstanceStore();
  instanceStore.upsert({
    config: { id: "instance-1", label: "Instance 1" },
    runtime: {
      terminalBackend: "zellij",
      zellijSessionId:
        options && "sessionId" in options ? options.sessionId : "zellij-1",
    },
    state: "connected",
  });

  const selectPane = vi
    .spyOn(zellijManager, "selectPane")
    .mockResolvedValue(undefined);
  const listPanes = vi
    .spyOn(zellijManager, "listPanes")
    .mockResolvedValue(options?.panes ?? defaultZellijPanes);
  const splitPane = vi
    .spyOn(zellijManager, "splitPane")
    .mockResolvedValue("terminal_new");
  const sendTextToPane = vi
    .spyOn(zellijManager, "sendTextToPane")
    .mockResolvedValue(undefined);
  const resizePane = vi
    .spyOn(zellijManager, "resizePane")
    .mockResolvedValue(undefined);
  const killPane = vi
    .spyOn(zellijManager, "killPane")
    .mockResolvedValue(undefined);
  const nextTab = vi.spyOn(zellijManager, "nextTab").mockResolvedValue(undefined);
  const prevTab = vi.spyOn(zellijManager, "prevTab").mockResolvedValue(undefined);
  const createTab = vi
    .spyOn(zellijManager, "createTab")
    .mockResolvedValue(undefined);
  const listTabs = vi
    .spyOn(zellijManager, "listTabs")
    .mockResolvedValue(options?.tabs ?? defaultZellijTabs);
  const killTab = vi.spyOn(zellijManager, "killTab").mockResolvedValue(undefined);
  const selectTab = vi
    .spyOn(zellijManager, "selectTab")
    .mockResolvedValue(undefined);
  const killSession = vi
    .spyOn(zellijManager, "killSession")
    .mockResolvedValue(undefined);
  const tmuxSplitPane = vi.spyOn(tmuxManager, "splitPane");

  const deps: TmuxPaneCommandDependencies = {
    tmuxManager,
    zellijManager,
    instanceStore,
    resolveActiveTmuxSessionId: vi.fn(() => undefined),
    resolveActiveTmuxFocus: vi.fn(async () => undefined),
    resolveWorkspacePath: vi.fn(() => "/test/workspace"),
    provider,
  };
  registerTmuxPaneCommands(deps);

  const handlers = new Map(
    vi
      .mocked(vscode.commands.registerCommand)
      .mock.calls.map(([id, callback]) => [
        id,
        callback as RegisteredCommandHandler,
      ]),
  );
  expect(tmuxSplitPane).not.toHaveBeenCalled();

  return {
    deps,
    zellijManager,
    handlers,
    selectPane,
    listPanes,
    splitPane,
    sendTextToPane,
    resizePane,
    killPane,
    nextTab,
    prevTab,
    createTab,
    listTabs,
    killTab,
    selectTab,
    killSession,
  };
}

function panePick(paneId: string, label: string, description: string) {
  return { label, description, paneId };
}

function windowPick(windowId: string, label: string, description: string) {
  return { label, description, windowId };
}

function mockQuickPickOnce(value: unknown): void {
  vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(value as never);
}

function mockInputBoxOnce(value: string | undefined): void {
  vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(value);
}

function mockWarningOnce(value: string | undefined): void {
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(
    value as never,
  );
}

function getHandler(
  harness: { handlers: Map<string, RegisteredCommandHandler> },
  commandId: string,
): RegisteredCommandHandler {
  const handler = harness.handlers.get(commandId);
  expect(handler).toBeDefined();
  return handler as RegisteredCommandHandler;
}

describe("registerTmuxPaneCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers all 15 tmux pane commands", () => {
    const harness = createHarness();

    expect(harness.handlers.size).toBe(15);
    expect([...harness.handlers.keys()]).toEqual([
      "ulw.tmuxSwitchPane",
      "ulw.tmuxSplitPaneH",
      "ulw.tmuxSplitPaneV",
      "ulw.tmuxSplitPaneWithCommand",
      "ulw.tmuxSendTextToPane",
      "ulw.tmuxResizePane",
      "ulw.tmuxSwapPane",
      "ulw.tmuxKillPane",
      "ulw.tmuxNextWindow",
      "ulw.tmuxPrevWindow",
      "ulw.tmuxCreateWindow",
      "ulw.tmuxKillWindow",
      "ulw.tmuxSelectWindow",
      "ulw.tmuxKillSession",
      "ulw.tmuxRefresh",
    ]);
  });

  it("switches panes via direct arg and quick pick selection with active markers", async () => {
    const harness = createHarness();
    const handler = getHandler(harness, "ulw.tmuxSwitchPane");

    await handler({ paneId: "%2" });
    expect(harness.selectPane).toHaveBeenCalledWith("%2");

    mockQuickPickOnce(undefined);
    await handler();
    expect(harness.listPanes).toHaveBeenCalledWith("session-1");
    expect(harness.selectPane).toHaveBeenCalledTimes(1);

    mockQuickPickOnce(panePick("%1", "$(check) Pane 0: editor", "%1"));
    await handler();

    expect(harness.selectPane).toHaveBeenLastCalledWith("%1");

    const quickPickCall = vi.mocked(vscode.window.showQuickPick).mock.calls[0];
    const items = quickPickCall?.[0] as Array<{
      label: string;
      description: string;
    }>;
    expect(items[0]).toEqual({
      label: "$(check) Pane 0: editor",
      description: "%1",
      paneId: "%1",
    });
    expect(items[1]).toEqual({
      label: "Pane 1: shell",
      description: "%2",
      paneId: "%2",
    });
  });

  it("splits panes horizontally and vertically with session fallback, no-session return, and errors", async () => {
    const horizontalHarness = createHarness();
    const horizontal = getHandler(
      horizontalHarness,
      "ulw.tmuxSplitPaneH",
    );

    await horizontal({ paneId: "%2", sessionId: "session-2" });
    await horizontal({ sessionId: "session-2" });

    expect(horizontalHarness.splitPane).toHaveBeenNthCalledWith(1, "%2", "h", {
      workingDirectory: "/test/workspace",
    });
    expect(horizontalHarness.splitPane).toHaveBeenNthCalledWith(2, "%1", "h", {
      workingDirectory: "/test/workspace",
    });

    const noSessionHarness = createHarness({ sessionId: undefined });
    await getHandler(noSessionHarness, "ulw.tmuxSplitPaneV")();
    expect(noSessionHarness.splitPane).not.toHaveBeenCalled();

    const verticalHarness = createHarness();
    verticalHarness.splitPane.mockRejectedValueOnce(new Error("boom"));

    await getHandler(
      verticalHarness,
      "ulw.tmuxSplitPaneV",
    )({
      sessionId: "session-3",
    });

    expect(verticalHarness.splitPane).toHaveBeenCalledWith("%1", "v", {
      workingDirectory: "/test/workspace",
    });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to split pane",
    );
  });

  it("splits pane with command for cancel, success, and error paths", async () => {
    const harness = createHarness();
    const handler = getHandler(harness, "ulw.tmuxSplitPaneWithCommand");

    mockInputBoxOnce(undefined);
    await handler({ sessionId: "session-1" });
    expect(harness.splitPane).not.toHaveBeenCalled();

    mockInputBoxOnce("htop");
    await handler({ paneId: "%1", sessionId: "session-1" });
    expect(harness.splitPane).toHaveBeenCalledWith("%1", "v", {
      command: "htop",
      workingDirectory: "/test/workspace",
    });

    harness.splitPane.mockRejectedValueOnce(new Error("boom"));
    mockInputBoxOnce("npm run dev");
    await handler({ sessionId: "session-1" });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to split pane",
    );
  });

  it("sends text to panes from direct args and quick-pick selection", async () => {
    const harness = createHarness();
    const handler = getHandler(harness, "ulw.tmuxSendTextToPane");

    mockInputBoxOnce(undefined);
    mockInputBoxOnce("ls -la");
    mockInputBoxOnce("pwd");

    await handler({ paneId: "%2" });
    expect(harness.sendTextToPane).not.toHaveBeenCalled();

    await handler({ paneId: "%2" });
    expect(harness.sendTextToPane).toHaveBeenCalledWith("%2", "ls -la");

    mockQuickPickOnce(undefined);
    mockQuickPickOnce(panePick("%1", "Pane 0: editor", "%1"));

    await handler();
    expect(harness.sendTextToPane).toHaveBeenCalledTimes(1);

    await handler();
    expect(harness.sendTextToPane).toHaveBeenLastCalledWith("%1", "pwd");
  });

  it("returns early when sending text without a focused session", async () => {
    const harness = createHarness({ sessionId: undefined });

    await getHandler(harness, "ulw.tmuxSendTextToPane")();

    expect(harness.sendTextToPane).not.toHaveBeenCalled();
  });

  it("resizes panes across cancel, validation, success, and error branches", async () => {
    const harness = createHarness();
    const handler = getHandler(harness, "ulw.tmuxResizePane");

    mockQuickPickOnce(undefined);
    mockQuickPickOnce(panePick("%1", "Pane 0: editor", "%1"));
    mockQuickPickOnce(undefined);
    mockQuickPickOnce(panePick("%1", "Pane 0: editor", "%1"));
    mockQuickPickOnce("Left");
    mockQuickPickOnce(panePick("%1", "Pane 0: editor", "%1"));
    mockQuickPickOnce("Down");
    mockQuickPickOnce("Up");

    mockInputBoxOnce(undefined);
    mockInputBoxOnce("7");
    mockInputBoxOnce("3");

    await handler();
    await handler();
    await handler();
    await handler();
    expect(harness.resizePane).toHaveBeenCalledWith("%1", "D", 7);

    const resizePromptCall = vi.mocked(vscode.window.showInputBox).mock
      .calls[0];
    const validateInput = resizePromptCall?.[0]?.validateInput;
    expect(validateInput?.("abc")).toBe("Must be a positive number");
    expect(validateInput?.("5")).toBeUndefined();

    harness.resizePane.mockRejectedValueOnce(new Error("boom"));
    await handler({ paneId: "%2" });
    expect(harness.resizePane).toHaveBeenLastCalledWith("%2", "U", 3);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to resize pane",
    );
  });

  it("swaps panes across cancellation, last-target prevention, success, and error paths", async () => {
    const harness = createHarness();
    const handler = getHandler(harness, "ulw.tmuxSwapPane");

    mockQuickPickOnce(undefined);
    mockQuickPickOnce(panePick("%1", "Pane 0: editor", "%1"));
    mockQuickPickOnce(undefined);
    mockQuickPickOnce(panePick("%1", "Pane 0: editor", "%1"));
    mockQuickPickOnce(panePick("%2", "Pane 1: shell", "%2"));
    mockQuickPickOnce(panePick("%2", "Pane 1: shell", "%2"));

    await handler();
    await handler();
    expect(harness.swapPanes).not.toHaveBeenCalled();

    await handler();
    expect(harness.swapPanes).toHaveBeenCalledWith("%1", "%2");

    const singlePaneHarness = createHarness({ panes: [defaultPanes[0]] });
    const singlePaneHandler = getHandler(
      singlePaneHarness,
      "ulw.tmuxSwapPane",
    );
    vi.mocked(vscode.window.showQuickPick).mockReset();
    mockQuickPickOnce(panePick("%1", "Pane 0: editor", "%1"));
    await singlePaneHandler();
    expect(singlePaneHarness.swapPanes).not.toHaveBeenCalled();

    vi.mocked(vscode.window.showQuickPick).mockReset();
    mockQuickPickOnce(panePick("%2", "Pane 1: shell", "%2"));
    harness.swapPanes.mockRejectedValueOnce(new Error("boom"));
    await handler({ paneId: "%1" });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to swap panes",
    );
  });

  it("returns early for direct swap pane when there are no targets or target pick is cancelled", async () => {
    const singlePaneHarness = createHarness({ panes: [defaultPanes[0]] });
    await getHandler(singlePaneHarness, "ulw.tmuxSwapPane")({ paneId: "%1" });
    expect(singlePaneHarness.swapPanes).not.toHaveBeenCalled();

    const harness = createHarness();
    mockQuickPickOnce(undefined);
    await getHandler(harness, "ulw.tmuxSwapPane")({ paneId: "%1" });
    expect(harness.swapPanes).not.toHaveBeenCalled();
  });

  it("kills panes with last-pane prevention, destructive confirmation, cancellation, and error handling", async () => {
    const multiPaneHarness = createHarness();
    const handler = getHandler(multiPaneHarness, "ulw.tmuxKillPane");

    mockQuickPickOnce(undefined);
    mockQuickPickOnce(panePick("%2", "Pane 1: shell", "%2"));
    mockWarningOnce("Kill");
    mockWarningOnce("Cancel");
    mockWarningOnce("Kill");

    await handler();
    expect(multiPaneHarness.killPane).not.toHaveBeenCalled();

    await handler();
    expect(multiPaneHarness.killPane).toHaveBeenCalledWith("%2");

    await handler({ paneId: "%2" });
    expect(multiPaneHarness.killPane).toHaveBeenCalledTimes(1);

    multiPaneHarness.killPane.mockRejectedValueOnce(new Error("boom"));
    await handler({ paneId: "%2" });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to kill pane",
    );

    const singlePaneHarness = createHarness({ panes: [defaultPanes[0]] });
    const singlePaneHandler = getHandler(
      singlePaneHarness,
      "ulw.tmuxKillPane",
    );

    await singlePaneHandler();
    await singlePaneHandler({ paneId: "%1" });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "Cannot kill the last pane — use 'Kill Session' instead",
    );
  });

  it("handles quick-pick kill pane confirmation cancellation and errors", async () => {
    const harness = createHarness();
    const handler = getHandler(harness, "ulw.tmuxKillPane");

    mockQuickPickOnce(panePick("%2", "Pane 1: shell", "%2"));
    mockWarningOnce("Cancel");
    await handler();
    expect(harness.killPane).not.toHaveBeenCalled();

    mockQuickPickOnce(panePick("%2", "Pane 1: shell", "%2"));
    mockWarningOnce("Kill");
    harness.killPane.mockRejectedValueOnce(new Error("kill failed"));
    await handler();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to kill pane",
    );
  });

  it.each([
    [
      "ulw.tmuxNextWindow",
      "nextWindow",
      "Failed to switch to next window",
    ],
    [
      "ulw.tmuxPrevWindow",
      "prevWindow",
      "Failed to switch to previous window",
    ],
    ["ulw.tmuxCreateWindow", "createWindow", "Failed to create window"],
  ] as const)(
    "%s navigates tmux windows and reports command errors",
    async (commandId, methodName, errorMessage) => {
      const noSessionHarness = createHarness({ sessionId: undefined });
      await getHandler(noSessionHarness, commandId)();
      expect(noSessionHarness[methodName]).not.toHaveBeenCalled();

      const harness = createHarness();
      const handler = getHandler(harness, commandId);

      await handler();
      if (methodName === "createWindow") {
        expect(harness[methodName]).toHaveBeenCalledWith(
          "session-1",
          "/test/workspace",
        );
      } else {
        expect(harness[methodName]).toHaveBeenCalledWith("session-1");
      }

      harness[methodName].mockRejectedValueOnce(new Error("boom"));
      await handler();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(errorMessage);
    },
  );

  it("kills windows through quick pick, confirmation, direct args, and error handling", async () => {
    const harness = createHarness();
    const handler = getHandler(harness, "ulw.tmuxKillWindow");

    mockQuickPickOnce(undefined);
    mockQuickPickOnce(windowPick("@1", "$(check) Window 1: main", "@1"));
    mockWarningOnce("Kill");
    mockWarningOnce("Cancel");
    mockWarningOnce("Kill");

    await handler();
    expect(harness.killWindow).not.toHaveBeenCalled();

    await handler();
    expect(harness.killWindow).toHaveBeenCalledWith("@1");

    await handler({ windowId: "@2" });
    expect(harness.killWindow).toHaveBeenCalledTimes(1);

    const windowItems = vi.mocked(vscode.window.showQuickPick).mock
      .calls[1]?.[0] as Array<{
      label: string;
      windowId: string;
    }>;
    expect(windowItems[0]).toEqual({
      label: "$(check) Window 1: main",
      description: "@1",
      windowId: "@1",
    });

    harness.killWindow.mockRejectedValueOnce(new Error("boom"));
    await handler({ windowId: "@2" });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to kill window",
    );
  });

  it("selects windows from quick picks or direct args and handles errors", async () => {
    const harness = createHarness();
    const handler = getHandler(harness, "ulw.tmuxSelectWindow");

    mockQuickPickOnce(undefined);
    mockQuickPickOnce(windowPick("@2", "Window 2: logs", "@2"));

    await handler();
    expect(harness.selectWindow).not.toHaveBeenCalled();

    await handler();
    expect(harness.selectWindow).toHaveBeenCalledWith("@2");

    harness.selectWindow.mockRejectedValueOnce(new Error("boom"));
    await handler({ windowId: "@1" });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to select window",
    );
  });

  it("kills sessions only after confirmation and surfaces failures", async () => {
    const noSessionHarness = createHarness({ sessionId: undefined });
    await getHandler(noSessionHarness, "ulw.tmuxKillSession")();
    expect(noSessionHarness.killSession).not.toHaveBeenCalled();

    const harness = createHarness();
    const handler = getHandler(harness, "ulw.tmuxKillSession");

    mockWarningOnce("Cancel");
    mockWarningOnce("Kill");
    mockWarningOnce("Kill");

    await handler();
    expect(harness.killSession).not.toHaveBeenCalled();

    await handler({ sessionId: "session-2" });
    expect(harness.killSession).toHaveBeenCalledWith("session-2");

    harness.killSession.mockRejectedValueOnce(new Error("boom"));
    await handler();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to kill session",
    );
  });

  it("routes pane operations to zellij when zellij is active", async () => {
    const harness = createZellijHarness();

    await getHandler(harness, "ulw.tmuxSwitchPane")({
      paneId: "terminal_2",
    });
    expect(harness.selectPane).toHaveBeenCalledWith("terminal_2");

    await getHandler(harness, "ulw.tmuxSplitPaneH")({
      paneId: "terminal_1",
      sessionId: "zellij-1",
    });
    expect(harness.selectPane).toHaveBeenLastCalledWith("terminal_1");
    expect(harness.splitPane).toHaveBeenCalledWith("h", {
      workingDirectory: "/test/workspace",
    });

    mockInputBoxOnce("pwd");
    await getHandler(harness, "ulw.tmuxSendTextToPane")({
      paneId: "terminal_2",
    });
    expect(harness.selectPane).toHaveBeenLastCalledWith("terminal_2");
    expect(harness.sendTextToPane).toHaveBeenCalledWith("pwd");

    mockQuickPickOnce("Left");
    mockInputBoxOnce("4");
    await getHandler(harness, "ulw.tmuxResizePane")({
      paneId: "terminal_2",
    });
    expect(harness.resizePane).toHaveBeenCalledWith("left", 4);
  });

  it("lists zellij panes for quick-pick switching and maps focused state into tmux pane items", async () => {
    const harness = createZellijHarness({
      panes: [
        { id: "terminal_1", title: "editor", isFocused: false, isFloating: false },
        { id: "terminal_2", title: "shell", isFocused: true, isFloating: false },
      ],
    });
    mockQuickPickOnce(
      panePick("terminal_2", "$(check) Pane 1: shell", "terminal_2"),
    );

    await getHandler(harness, "ulw.tmuxSwitchPane")();

    expect(harness.listPanes).toHaveBeenCalledTimes(1);
    expect(harness.selectPane).toHaveBeenCalledWith("terminal_2");
    const items = vi.mocked(vscode.window.showQuickPick).mock.calls[0]?.[0] as Array<{
      label: string;
      paneId: string;
    }>;
    expect(items).toEqual([
      { label: "Pane 0: editor", description: "terminal_1", paneId: "terminal_1" },
      {
        label: "$(check) Pane 1: shell",
        description: "terminal_2",
        paneId: "terminal_2",
      },
    ]);
  });

  it("falls back to the first zellij pane as focused context and handles missing zellij session context", async () => {
    const harness = createZellijHarness({
      panes: [
        { id: "terminal_1", title: "editor", isFocused: false, isFloating: false },
      ],
    });

    await getHandler(harness, "ulw.tmuxSplitPaneV")({ sessionId: "zellij-1" });

    expect(harness.selectPane).toHaveBeenCalledWith("terminal_1");
    expect(harness.splitPane).toHaveBeenCalledWith("v", {
      workingDirectory: "/test/workspace",
    });

    const noSessionHarness = createZellijHarness({ sessionId: undefined });
    await getHandler(noSessionHarness, "ulw.tmuxSplitPaneH")();
    expect(noSessionHarness.splitPane).not.toHaveBeenCalled();
  });

  it("returns early when focused zellij or tmux context cannot resolve panes", async () => {
    const emptyZellijHarness = createZellijHarness({ panes: [] });
    await getHandler(emptyZellijHarness, "ulw.tmuxSplitPaneH")();
    expect(emptyZellijHarness.splitPane).not.toHaveBeenCalled();

    const failingZellijHarness = createZellijHarness();
    failingZellijHarness.listPanes.mockRejectedValueOnce(new Error("list failed"));
    await getHandler(failingZellijHarness, "ulw.tmuxSplitPaneH")();
    expect(failingZellijHarness.splitPane).not.toHaveBeenCalled();

    const emptyTmuxHarness = createHarness({ panes: [] });
    emptyTmuxHarness.deps.resolveActiveTmuxFocus = vi.fn(async () => undefined);
    await getHandler(emptyTmuxHarness, "ulw.tmuxSplitPaneH")();
    expect(emptyTmuxHarness.splitPane).not.toHaveBeenCalled();

    const failingTmuxHarness = createHarness();
    failingTmuxHarness.deps.resolveActiveTmuxFocus = vi.fn(async () => undefined);
    failingTmuxHarness.listPanes.mockRejectedValueOnce(new Error("list failed"));
    await getHandler(failingTmuxHarness, "ulw.tmuxSplitPaneH")();
    expect(failingTmuxHarness.splitPane).not.toHaveBeenCalled();
  });

  it("falls back to tmux when active backend lookup throws", async () => {
    const harness = createHarness();
    const instanceStore = new InstanceStore();
    vi.spyOn(instanceStore, "getActive").mockImplementation(() => {
      throw new Error("active missing");
    });
    harness.deps.instanceStore = instanceStore;

    await getHandler(harness, "ulw.tmuxSwitchPane")({ paneId: "%2" });

    expect(harness.selectPane).toHaveBeenCalledWith("%2");
  });

  it("returns no zellij session id when zellij runtime lookup throws", async () => {
    const harness = createZellijHarness();
    const record: Parameters<InstanceStore["upsert"]>[0] = {
      config: { id: "instance-throw", label: "Throwing Instance" },
      runtime: { terminalBackend: "zellij", zellijSessionId: "zellij-throw" },
      state: "connected",
    };
    vi.spyOn(harness.deps.instanceStore!, "getActive")
      .mockImplementationOnce(() => record)
      .mockImplementationOnce(() => {
        throw new Error("session missing");
      });

    await getHandler(harness, "ulw.tmuxSplitPaneH")();

    expect(harness.splitPane).not.toHaveBeenCalled();
  });

  it("covers resize direction variants and default fallback", async () => {
    const harness = createHarness();
    const handler = getHandler(harness, "ulw.tmuxResizePane");

    mockQuickPickOnce("Right");
    mockInputBoxOnce("6");
    await handler({ paneId: "%2" });

    mockQuickPickOnce("Diagonal");
    mockInputBoxOnce("8");
    await handler({ paneId: "%2" });

    expect(harness.resizePane).toHaveBeenNthCalledWith(1, "%2", "R", 6);
    expect(harness.resizePane).toHaveBeenNthCalledWith(2, "%2", "D", 8);
  });

  it("no-ops helper-backed commands when the pane manager is unavailable", async () => {
    const harness = createHarness();
    harness.deps.tmuxManager = undefined;

    await getHandler(harness, "ulw.tmuxSplitPaneH")({
      paneId: "%1",
      sessionId: "session-1",
    });
    await getHandler(harness, "ulw.tmuxResizePane")({ paneId: "%1" });
    await getHandler(harness, "ulw.tmuxKillWindow")({ windowId: "@1" });
    await getHandler(harness, "ulw.tmuxSelectWindow")({ windowId: "@1" });
    await getHandler(harness, "ulw.tmuxKillPane")({ paneId: "%1" });

    expect(harness.splitPane).not.toHaveBeenCalled();
    expect(harness.resizePane).not.toHaveBeenCalled();
    expect(harness.killWindow).not.toHaveBeenCalled();
    expect(harness.selectWindow).not.toHaveBeenCalled();
    expect(harness.killPane).not.toHaveBeenCalled();
  });

  it("routes zellij tab and session commands and disables swap", async () => {
    const harness = createZellijHarness();

    await getHandler(harness, "ulw.tmuxNextWindow")();
    await getHandler(harness, "ulw.tmuxPrevWindow")();
    await getHandler(harness, "ulw.tmuxCreateWindow")();
    expect(harness.nextTab).toHaveBeenCalledTimes(1);
    expect(harness.prevTab).toHaveBeenCalledTimes(1);
    expect(harness.createTab).toHaveBeenCalledWith({
      workingDirectory: "/test/workspace",
    });

    mockQuickPickOnce(windowPick("2", "Tab 2: logs", "2"));
    await getHandler(harness, "ulw.tmuxSelectWindow")();
    expect(harness.listTabs).toHaveBeenCalledTimes(1);
    expect(harness.selectTab).toHaveBeenCalledWith(2);

    mockWarningOnce("Kill");
    await getHandler(harness, "ulw.tmuxKillWindow")({ windowId: "2" });
    expect(harness.selectTab).toHaveBeenLastCalledWith(2);
    expect(harness.killTab).toHaveBeenCalledTimes(1);

    await getHandler(harness, "ulw.tmuxSwapPane")({
      paneId: "terminal_1",
    });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "Swap pane is not supported for zellij",
    );

    mockWarningOnce("Kill");
    await getHandler(harness, "ulw.tmuxKillSession")();
    expect(harness.killSession).toHaveBeenCalledWith("zellij-1");
  });

  it("kills zellij panes by selecting the target pane before kill", async () => {
    const harness = createZellijHarness();
    mockWarningOnce("Kill");

    await getHandler(harness, "ulw.tmuxKillPane")({
      paneId: "terminal_2",
    });

    expect(harness.selectPane).toHaveBeenCalledWith("terminal_2");
    expect(harness.killPane).toHaveBeenCalledTimes(1);
  });

  it("returns early for zellij kill pane when no active session exists", async () => {
    const harness = createZellijHarness({ sessionId: undefined });

    await getHandler(harness, "ulw.tmuxKillPane")({
      paneId: "terminal_2",
    });

    expect(harness.killPane).not.toHaveBeenCalled();
  });

  it("covers tmux no-manager, no-session, and helper early-return branches", async () => {
    const noManager = createHarness();
    noManager.deps.tmuxManager = undefined;

    await getHandler(noManager, "ulw.tmuxSwitchPane")({ paneId: "%1" });
    await getHandler(noManager, "ulw.tmuxSplitPaneV")({
      paneId: "%1",
      sessionId: "session-1",
    });
    await getHandler(noManager, "ulw.tmuxSplitPaneWithCommand")({
      paneId: "%1",
      sessionId: "session-1",
    });
    await getHandler(noManager, "ulw.tmuxSendTextToPane")({ paneId: "%1" });
    await getHandler(noManager, "ulw.tmuxSwapPane")({ paneId: "%1" });
    await getHandler(noManager, "ulw.tmuxPrevWindow")();
    await getHandler(noManager, "ulw.tmuxCreateWindow")();
    await getHandler(noManager, "ulw.tmuxKillSession")({
      sessionId: "session-1",
    });

    expect(noManager.selectPane).not.toHaveBeenCalled();
    expect(noManager.splitPane).not.toHaveBeenCalled();
    expect(noManager.sendTextToPane).not.toHaveBeenCalled();
    expect(noManager.swapPanes).not.toHaveBeenCalled();
    expect(noManager.prevWindow).not.toHaveBeenCalled();
    expect(noManager.createWindow).not.toHaveBeenCalled();
    expect(noManager.killSession).not.toHaveBeenCalled();

    const noSession = createHarness({ sessionId: undefined });
    await getHandler(noSession, "ulw.tmuxSwitchPane")();
    await getHandler(noSession, "ulw.tmuxSwapPane")({ paneId: "%1" });
    await getHandler(noSession, "ulw.tmuxKillWindow")({ windowId: "@1" });
    await getHandler(noSession, "ulw.tmuxSelectWindow")({ windowId: "@1" });
    expect(noSession.selectPane).not.toHaveBeenCalled();
    expect(noSession.swapPanes).not.toHaveBeenCalled();
    expect(noSession.killWindow).not.toHaveBeenCalled();
    expect(noSession.selectWindow).not.toHaveBeenCalled();

    const splitHelper = createHarness();
    vi.mocked(splitHelper.deps.resolveWorkspacePath).mockImplementation(() => {
      splitHelper.deps.tmuxManager = undefined;
      return "/test/workspace";
    });
    await getHandler(splitHelper, "ulw.tmuxSplitPaneH")({
      paneId: "%1",
      sessionId: "session-1",
    });
    expect(splitHelper.splitPane).not.toHaveBeenCalled();

    const sendPick = createHarness();
    sendPick.deps.resolveActiveTmuxFocus = vi.fn(async () => {
      sendPick.deps.tmuxManager = undefined;
      return { sessionId: "session-1", windowId: "@1", paneId: "%1" };
    });
    await getHandler(sendPick, "ulw.tmuxSendTextToPane")();
    expect(sendPick.sendTextToPane).not.toHaveBeenCalled();

    const resizeHelper = createHarness();
    mockQuickPickOnce("Left");
    vi.mocked(vscode.window.showInputBox).mockImplementationOnce(async () => {
      resizeHelper.deps.tmuxManager = undefined;
      return "3";
    });
    await getHandler(resizeHelper, "ulw.tmuxResizePane")({ paneId: "%1" });
    expect(resizeHelper.resizePane).not.toHaveBeenCalled();

    const listWindowHelper = createHarness();
    listWindowHelper.deps.resolveActiveTmuxFocus = vi.fn(async () => {
      listWindowHelper.deps.tmuxManager = undefined;
      return { sessionId: "session-1", windowId: "@1", paneId: "%1" };
    });
    await getHandler(listWindowHelper, "ulw.tmuxKillWindow")();
    await getHandler(listWindowHelper, "ulw.tmuxSelectWindow")();
    expect(listWindowHelper.killWindow).not.toHaveBeenCalled();
    expect(listWindowHelper.selectWindow).not.toHaveBeenCalled();
  });

  it("covers focused fallback, empty-title picks, and remaining command error branches", async () => {
    const noActivePane = createHarness({
      panes: [{ paneId: "%3", index: 2, title: "", isActive: false }],
    });
    noActivePane.deps.resolveActiveTmuxFocus = vi.fn(async () => undefined);
    await getHandler(noActivePane, "ulw.tmuxSplitPaneH")();
    expect(noActivePane.splitPane).toHaveBeenCalledWith("%3", "h", {
      workingDirectory: "/test/workspace",
    });

    const emptyTmux = createHarness({ panes: [] });
    emptyTmux.deps.resolveActiveTmuxFocus = vi.fn(async () => undefined);
    mockInputBoxOnce("npm test");
    await getHandler(emptyTmux, "ulw.tmuxSplitPaneWithCommand")({
      sessionId: "session-1",
    });
    expect(emptyTmux.splitPane).not.toHaveBeenCalled();

    const emptyTitleSwitch = createHarness({
      panes: [{ paneId: "%4", index: 4, title: "", isActive: true }],
    });
    mockQuickPickOnce(panePick("%4", "$(check) Pane 4", "%4"));
    await getHandler(emptyTitleSwitch, "ulw.tmuxSwitchPane")();
    const quickPickCalls = vi.mocked(vscode.window.showQuickPick).mock.calls;
    const emptyTitleItems = quickPickCalls[quickPickCalls.length - 1]?.[0] as Array<{
      label: string;
      description: string;
      paneId: string;
    }>;
    expect(emptyTitleItems[0]).toEqual({
      label: "$(check) Pane 4",
      description: "%4",
      paneId: "%4",
    });

    const splitHError = createHarness();
    splitHError.splitPane.mockRejectedValueOnce(new Error("boom"));
    await getHandler(splitHError, "ulw.tmuxSplitPaneH")({
      paneId: "%1",
      sessionId: "session-1",
    });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to split pane",
    );

    const resizeNoSession = createHarness({ sessionId: undefined });
    await getHandler(resizeNoSession, "ulw.tmuxResizePane")();
    expect(resizeNoSession.resizePane).not.toHaveBeenCalled();
    mockQuickPickOnce(undefined);
    await getHandler(resizeNoSession, "ulw.tmuxResizePane")({ paneId: "%1" });
    expect(resizeNoSession.resizePane).not.toHaveBeenCalled();

    const resizeNoManagerAfterPick = createHarness();
    mockQuickPickOnce(panePick("%1", "Pane 0", "%1"));
    mockQuickPickOnce("Right");
    vi.mocked(vscode.window.showInputBox).mockImplementationOnce(async () => {
      resizeNoManagerAfterPick.deps.tmuxManager = undefined;
      return "2";
    });
    await getHandler(resizeNoManagerAfterPick, "ulw.tmuxResizePane")();
    expect(resizeNoManagerAfterPick.resizePane).not.toHaveBeenCalled();

    const sourceSwapError = createHarness();
    mockQuickPickOnce(panePick("%1", "Pane 0", "%1"));
    mockQuickPickOnce(panePick("%2", "Pane 1", "%2"));
    sourceSwapError.swapPanes.mockRejectedValueOnce(new Error("boom"));
    await getHandler(sourceSwapError, "ulw.tmuxSwapPane")();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to swap panes",
    );
  });

  it("covers remaining no-session and helper mutation branches", async () => {
    const zellijThrow = createZellijHarness();
    const activeRecord: Parameters<InstanceStore["upsert"]>[0] = {
      config: { id: "instance-throw", label: "Throwing Instance" },
      runtime: { terminalBackend: "zellij", zellijSessionId: "zellij-1" },
      state: "connected",
    };
    vi.spyOn(zellijThrow.deps.instanceStore!, "getActive")
      .mockImplementationOnce(() => activeRecord)
      .mockImplementationOnce(() => activeRecord)
      .mockImplementationOnce(() => {
        throw new Error("missing active runtime");
      });
    await getHandler(zellijThrow, "ulw.tmuxKillSession")();
    expect(zellijThrow.killSession).not.toHaveBeenCalled();

    const selectHelper = createHarness();
    selectHelper.deps.resolveActiveTmuxFocus = vi.fn(async () => {
      selectHelper.deps.tmuxManager = undefined;
      return { sessionId: "session-1", windowId: "@1", paneId: "%1" };
    });
    await getHandler(selectHelper, "ulw.tmuxSelectWindow")({ windowId: "@1" });
    expect(selectHelper.selectWindow).not.toHaveBeenCalled();

    const killHelper = createHarness();
    killHelper.deps.resolveActiveTmuxFocus = vi.fn(async () => {
      killHelper.deps.tmuxManager = undefined;
      return { sessionId: "session-1", windowId: "@1", paneId: "%1" };
    });
    mockWarningOnce("Kill");
    await getHandler(killHelper, "ulw.tmuxKillWindow")({ windowId: "@1" });
    expect(killHelper.killWindow).not.toHaveBeenCalled();

    const sendTextCancelledAfterPick = createHarness();
    mockQuickPickOnce(panePick("%1", "Pane 0", "%1"));
    mockInputBoxOnce(undefined);
    await getHandler(sendTextCancelledAfterPick, "ulw.tmuxSendTextToPane")();
    expect(sendTextCancelledAfterPick.sendTextToPane).not.toHaveBeenCalled();
  });

  it("covers zellij unavailable-manager and resize direction branches", async () => {
    const noZellijManager = createZellijHarness();
    noZellijManager.deps.zellijManager = undefined;
    await getHandler(noZellijManager, "ulw.tmuxSwitchPane")({
      paneId: "terminal_1",
    });
    expect(noZellijManager.selectPane).not.toHaveBeenCalled();

    const harness = createZellijHarness();
    mockQuickPickOnce("Right");
    mockInputBoxOnce("2");
    await getHandler(harness, "ulw.tmuxResizePane")({
      paneId: "terminal_1",
    });
    mockQuickPickOnce("Up");
    mockInputBoxOnce("3");
    await getHandler(harness, "ulw.tmuxResizePane")({
      paneId: "terminal_1",
    });
    mockQuickPickOnce("Down");
    mockInputBoxOnce("4");
    await getHandler(harness, "ulw.tmuxResizePane")({
      paneId: "terminal_1",
    });

    expect(harness.resizePane).toHaveBeenCalledWith("right", 2);
    expect(harness.resizePane).toHaveBeenCalledWith("up", 3);
    expect(harness.resizePane).toHaveBeenCalledWith("down", 4);
  });

  it("no-ops pane commands for native backend", async () => {
    const harness = createZellijHarness();
    harness.deps.instanceStore?.upsert({
      config: { id: "instance-1", label: "Instance 1" },
      runtime: { terminalBackend: "native" },
      state: "connected",
    });

    await getHandler(harness, "ulw.tmuxSwitchPane")({
      paneId: "terminal_2",
    });
    await getHandler(harness, "ulw.tmuxNextWindow")();

    expect(harness.selectPane).not.toHaveBeenCalled();
    expect(harness.nextTab).not.toHaveBeenCalled();
  });

  it("restarts the terminal", async () => {
    const harness = createHarness();

    await getHandler(harness, "ulw.tmuxRefresh")();

    expect(
      (harness.deps.provider as Record<string, unknown>).restart,
    ).toHaveBeenCalled();
  });
});
