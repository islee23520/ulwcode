import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "../../test/mocks/vscode";
import { registerTerminalCommands } from "./terminalCommands";
import type { TerminalCommandDependencies } from "./terminalCommands";
import type { TerminalProvider } from "../../providers/TerminalProvider";
import type { OutputChannelService } from "../../services/OutputChannelService";

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../../test/mocks/vscode");
  return actual;
});

type CommandCallback = (...args: unknown[]) => unknown;

type ProviderMock = Pick<
  TerminalProvider,
  | "startOpenCode"
  | "focus"
  | "formatEditorReference"
  | "formatUriReference"
  | "requestPaste"
  | "pasteText"
  | "openInEditorTab"
  | "toggleEditorAttachment"
  | "startAtConfiguredLocation"
  | "focusAtConfiguredLocation"
>;

type OutputChannelMock = Pick<OutputChannelService, "info" | "warn" | "error">;

function createProviderMock(): ProviderMock {
  return {
    startOpenCode: vi.fn(),
    focus: vi.fn(),
    formatEditorReference: vi.fn(),
    formatUriReference: vi.fn((uri) => `@${uri.fsPath}`),
    requestPaste: vi.fn(),
    pasteText: vi.fn(),
    openInEditorTab: vi.fn(),
    toggleEditorAttachment: vi.fn(),
    startAtConfiguredLocation: vi.fn(),
    focusAtConfiguredLocation: vi.fn(),
  };
}

function createOutputChannelMock(): OutputChannelMock {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function mockConfiguration(options?: {
  autoFocusOnSend?: boolean;
  terminalDefaultLocation?: "editor" | "sidebar";
}): void {
  const {
    autoFocusOnSend = true,
    terminalDefaultLocation = "editor",
  } = options ?? {};
  const configuration = {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key === "autoFocusOnSend") {
        return autoFocusOnSend;
      }
      if (key === "terminal.defaultLocation") {
        return terminalDefaultLocation;
      }
      return defaultValue;
    }),
    inspect: vi.fn(() => undefined),
    update: vi.fn(),
  };

  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(configuration);
}

function mockAutoFocusOnSend(enabled: boolean): void {
  mockConfiguration({ autoFocusOnSend: enabled });
}

function createDependencies(
  overrides: Partial<TerminalCommandDependencies> = {},
): TerminalCommandDependencies {
  const provider = createProviderMock();
  const outputChannel = createOutputChannelMock();

  return {
    provider: provider as unknown as TerminalProvider,
    terminalManager: undefined,
    contextSharingService:
      {} as TerminalCommandDependencies["contextSharingService"],
    outputChannel: outputChannel as unknown as OutputChannelService,
    getActiveTerminalId: vi.fn(() => "terminal-1"),
    sendTerminalCwd: vi.fn(),
    sendPrompt: vi.fn(async () => undefined),
    ...overrides,
  };
}

function registerAndGetCommands(
  deps: TerminalCommandDependencies,
): Map<string, CommandCallback> {
  registerTerminalCommands(deps);

  return new Map(
    vi
      .mocked(vscode.commands.registerCommand)
      .mock.calls.map(([id, callback]) => [id, callback as CommandCallback]),
  );
}

function getCommand(
  commands: Map<string, CommandCallback>,
  id: string,
): CommandCallback {
  const command = commands.get(id);

  if (!command) {
    throw new Error(`Missing registered command: ${id}`);
  }

  return command;
}

describe("registerTerminalCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockConfiguration();
    vscode.window.activeTextEditor = undefined;
    vscode.window.tabGroups.all = [];
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("registers all 9 terminal commands", () => {
    const commands = registerAndGetCommands(createDependencies());

    expect(Array.from(commands.keys())).toEqual(
      expect.arrayContaining([
        "ulw.start",
        "ulw.sendToTerminal",
        "ulw.sendAtMention",
        "ulw.sendAllOpenFiles",
        "ulw.sendFileToTerminal",
        "ulw.paste",
        "ulw.focus",
        "ulw.openTerminalInEditor",
        "ulw.restoreTerminalToSidebar",
      ]),
    );
    expect(commands.size).toBe(9);
  });

  it("starts OpenCode from the start command", () => {
    mockConfiguration({ terminalDefaultLocation: "sidebar" });
    const deps = createDependencies();
    const commands = registerAndGetCommands(deps);

    getCommand(commands, "ulw.start")();

    expect(deps.provider?.startAtConfiguredLocation).toHaveBeenCalledTimes(1);
  });

  it("starts in an editor tab when terminal.defaultLocation is editor", () => {
    mockConfiguration({ terminalDefaultLocation: "editor" });
    const deps = createDependencies();
    const commands = registerAndGetCommands(deps);

    getCommand(commands, "ulw.start")();

    expect(deps.provider?.startAtConfiguredLocation).toHaveBeenCalledTimes(1);
    expect(deps.provider?.openInEditorTab).not.toHaveBeenCalled();
    expect(deps.provider?.startOpenCode).not.toHaveBeenCalled();
  });

  it("starts in the sidebar when terminal.defaultLocation is sidebar", () => {
    mockConfiguration({ terminalDefaultLocation: "sidebar" });
    const deps = createDependencies();
    const commands = registerAndGetCommands(deps);

    getCommand(commands, "ulw.start")();

    expect(deps.provider?.startAtConfiguredLocation).toHaveBeenCalledTimes(1);
    expect(deps.provider?.startOpenCode).not.toHaveBeenCalled();
    expect(deps.provider?.openInEditorTab).not.toHaveBeenCalled();
  });

  it("sends selected editor text to the terminal and focuses when enabled", () => {
    const deps = createDependencies();
    const document = new vscode.TextDocument(
      vscode.Uri.file("/workspace/file.ts"),
      "selected text",
    );
    const selection = new vscode.Selection(0, 0, 0, 4);
    const editor = new vscode.TextEditor(document, selection);
    vscode.window.activeTextEditor = editor;

    const commands = registerAndGetCommands(deps);
    getCommand(commands, "ulw.sendToTerminal")();

    expect(document.getText).toHaveBeenCalledWith(selection);
    expect(deps.getActiveTerminalId).toHaveBeenCalledTimes(1);
    expect(deps.outputChannel?.info).toHaveBeenCalledWith(
      '[DIAG:sendToTerminal] terminalId="terminal-1" textLength=13',
    );
    expect(deps.sendPrompt).toHaveBeenCalledWith("selected text\n");
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "ulw.focus",
    );

    vi.advanceTimersByTime(100);

    expect(deps.provider?.focus).toHaveBeenCalledTimes(1);
  });

  it("does not send selected text when there is no editor or selection", () => {
    const noEditorDeps = createDependencies();
    const noEditorCommands = registerAndGetCommands(noEditorDeps);

    getCommand(noEditorCommands, "ulw.sendToTerminal")();

    expect(noEditorDeps.sendPrompt).not.toHaveBeenCalled();
    expect(noEditorDeps.outputChannel?.info).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const emptySelectionDeps = createDependencies();
    const document = new vscode.TextDocument(
      vscode.Uri.file("/workspace/file.ts"),
      "ignored",
    );
    const emptySelection = new vscode.Selection(0, 0, 0, 0);
    vscode.window.activeTextEditor = new vscode.TextEditor(
      document,
      emptySelection,
    );

    const emptySelectionCommands = registerAndGetCommands(emptySelectionDeps);
    getCommand(emptySelectionCommands, "ulw.sendToTerminal")();

    expect(emptySelectionDeps.sendPrompt).not.toHaveBeenCalled();
    expect(emptySelectionDeps.outputChannel?.info).not.toHaveBeenCalled();
  });

  it("skips focus after sending selected text when autoFocusOnSend is disabled", () => {
    mockAutoFocusOnSend(false);

    const deps = createDependencies();
    const document = new vscode.TextDocument(
      vscode.Uri.file("/workspace/file.ts"),
      "text",
    );
    const selection = new vscode.Selection(0, 0, 0, 2);
    vscode.window.activeTextEditor = new vscode.TextEditor(document, selection);

    const commands = registerAndGetCommands(deps);
    getCommand(commands, "ulw.sendToTerminal")();

    expect(deps.sendPrompt).toHaveBeenCalledWith("text\n");
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "ulw.focus",
    );

    vi.runAllTimers();

    expect(deps.provider?.focus).not.toHaveBeenCalled();
  });

  it("sends editor references and falls back to cwd when @mention cannot be created", () => {
    const document = new vscode.TextDocument(
      vscode.Uri.file("/workspace/file.ts"),
      "content",
    );
    const selection = new vscode.Selection(0, 0, 0, 1);
    const editor = new vscode.TextEditor(document, selection);

    const successDeps = createDependencies();
    vi.mocked(successDeps.provider!.formatEditorReference).mockReturnValue(
      "@src/file.ts#L1",
    );
    vscode.window.activeTextEditor = editor;

    const successCommands = registerAndGetCommands(successDeps);
    getCommand(successCommands, "ulw.sendAtMention")();

    expect(successDeps.outputChannel?.info).toHaveBeenCalledWith(
      '[DIAG:sendAtMention] terminalId="terminal-1" fileRef="@src/file.ts#L1"',
    );
    expect(successDeps.sendPrompt).toHaveBeenCalledWith("@src/file.ts#L1 ");

    vi.advanceTimersByTime(100);

    expect(successDeps.provider?.focus).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const noProviderDeps = createDependencies({ provider: undefined });
    vscode.window.activeTextEditor = editor;
    const noProviderCommands = registerAndGetCommands(noProviderDeps);

    getCommand(noProviderCommands, "ulw.sendAtMention")();

    expect(noProviderDeps.outputChannel?.warn).toHaveBeenCalledWith(
      "[DIAG:sendAtMention] skipped — provider=false",
    );
    expect(noProviderDeps.sendTerminalCwd).toHaveBeenCalledTimes(1);
    expect(noProviderDeps.sendPrompt).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const noEditorDeps = createDependencies();
    vscode.window.activeTextEditor = undefined;
    const noEditorCommands = registerAndGetCommands(noEditorDeps);

    getCommand(noEditorCommands, "ulw.sendAtMention")();

    expect(noEditorDeps.outputChannel?.warn).toHaveBeenCalledWith(
      "[DIAG:sendAtMention] skipped — editor missing",
    );
    expect(noEditorDeps.sendTerminalCwd).toHaveBeenCalledTimes(1);
    expect(noEditorDeps.sendPrompt).not.toHaveBeenCalled();
  });

  it("sends all open file references while filtering unsupported tabs", () => {
    const deps = createDependencies();
    const fileUri = vscode.Uri.parse("file:///workspace/a.ts");
    const untitledUri = vscode.Uri.parse("untitled:///scratch.ts");
    const secondFileUri = vscode.Uri.parse("file:///workspace/b.ts");

    vi.mocked(deps.provider!.formatUriReference)
      .mockReturnValueOnce("@workspace/a.ts")
      .mockReturnValueOnce("@workspace/b.ts");

    vscode.window.tabGroups.all = [
      {
        tabs: [
          { input: new vscode.TabInputText(fileUri) },
          { input: new vscode.TabInputText(untitledUri) },
          { input: { uri: secondFileUri } },
        ],
      },
      {
        tabs: [{ input: new vscode.TabInputText(secondFileUri) }],
      },
    ];

    const commands = registerAndGetCommands(deps);
    getCommand(commands, "ulw.sendAllOpenFiles")();

    expect(deps.provider?.formatUriReference).toHaveBeenCalledTimes(2);
    expect(deps.outputChannel?.info).toHaveBeenCalledWith(
      '[DIAG:sendAllOpenFiles] terminalId="terminal-1" fileCount=2 refs="@workspace/a.ts @workspace/b.ts"',
    );
    expect(deps.sendPrompt).toHaveBeenCalledWith(
      "@workspace/a.ts @workspace/b.ts ",
    );

    vi.advanceTimersByTime(100);

    expect(deps.provider?.focus).toHaveBeenCalledTimes(1);
  });

  it("does not send all open files when no supported file refs exist", () => {
    const deps = createDependencies();
    vscode.window.tabGroups.all = [
      {
        tabs: [
          { input: new vscode.TabInputText(vscode.Uri.parse("untitled:///scratch.ts")) },
          { input: { uri: vscode.Uri.file("/workspace/not-tab-input.ts") } },
        ],
      },
    ];

    const commands = registerAndGetCommands(deps);
    getCommand(commands, "ulw.sendAllOpenFiles")();

    expect(deps.sendPrompt).not.toHaveBeenCalled();
    expect(deps.getActiveTerminalId).not.toHaveBeenCalled();
  });

  it("deduplicates queued file references and debounces prompt sending", () => {
    const deps = createDependencies();
    const firstUri = vscode.Uri.file("/workspace/a.ts");
    const duplicateUri = vscode.Uri.file("/workspace/a.ts");
    const secondUri = vscode.Uri.file("/workspace/b.ts");

    vi.mocked(deps.provider!.formatUriReference)
      .mockReturnValueOnce("@workspace/a.ts")
      .mockReturnValueOnce("@workspace/b.ts");

    const commands = registerAndGetCommands(deps);
    const sendFileToTerminal = getCommand(
      commands,
      "ulw.sendFileToTerminal",
    );

    sendFileToTerminal("ignored", [firstUri]);
    sendFileToTerminal("ignored", [duplicateUri, secondUri]);

    expect(deps.sendPrompt).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(deps.provider?.formatUriReference).toHaveBeenCalledTimes(2);
    expect(deps.outputChannel?.info).toHaveBeenCalledWith(
      '[DIAG:sendFileToTerminal] terminalId="terminal-1" fileCount=2 refs="@workspace/a.ts @workspace/b.ts"',
    );
    expect(deps.sendPrompt).toHaveBeenCalledTimes(1);
    expect(deps.sendPrompt).toHaveBeenCalledWith(
      "@workspace/a.ts @workspace/b.ts ",
    );

    vi.advanceTimersByTime(100);

    expect(deps.provider?.focus).toHaveBeenCalledTimes(1);
  });

  it("ignores file sends without context sharing or usable uri arguments", () => {
    const noContextDeps = createDependencies({ contextSharingService: undefined });
    const noContextCommands = registerAndGetCommands(noContextDeps);
    getCommand(noContextCommands, "ulw.sendFileToTerminal")(
      vscode.Uri.file("/workspace/a.ts"),
    );
    vi.advanceTimersByTime(100);

    expect(noContextDeps.sendPrompt).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const invalidArgsDeps = createDependencies();
    const invalidArgsCommands = registerAndGetCommands(invalidArgsDeps);
    getCommand(invalidArgsCommands, "ulw.sendFileToTerminal")("ignored");
    getCommand(invalidArgsCommands, "ulw.sendFileToTerminal")();
    vi.advanceTimersByTime(100);

    expect(invalidArgsDeps.sendPrompt).not.toHaveBeenCalled();
  });

  it("accepts a direct uri argument for file sends", () => {
    const deps = createDependencies();
    vi.mocked(deps.provider!.formatUriReference).mockReturnValueOnce(
      "@workspace/direct.ts",
    );
    const commands = registerAndGetCommands(deps);

    getCommand(commands, "ulw.sendFileToTerminal")(
      vscode.Uri.file("/workspace/direct.ts"),
    );
    vi.advanceTimersByTime(100);

    expect(deps.provider?.formatUriReference).toHaveBeenCalledTimes(1);
    expect(deps.sendPrompt).toHaveBeenCalledWith("@workspace/direct.ts ");
  });

  it("ignores empty file send batches after the debounce fires", () => {
    const deps = createDependencies();
    const commands = registerAndGetCommands(deps);

    getCommand(commands, "ulw.sendFileToTerminal")([]);
    vi.advanceTimersByTime(100);

    expect(deps.provider?.formatUriReference).not.toHaveBeenCalled();
    expect(deps.sendPrompt).not.toHaveBeenCalled();
  });

  it("drops queued file references when provider is unavailable", () => {
    const deps = createDependencies({ provider: undefined });
    const commands = registerAndGetCommands(deps);
    const sendFileToTerminal = getCommand(
      commands,
      "ulw.sendFileToTerminal",
    );

    sendFileToTerminal("ignored", [vscode.Uri.file("/workspace/a.ts")]);
    vi.advanceTimersByTime(100);

    expect(deps.sendPrompt).not.toHaveBeenCalled();

    sendFileToTerminal("ignored", [vscode.Uri.file("/workspace/b.ts")]);
    vi.advanceTimersByTime(100);

    expect(deps.sendPrompt).not.toHaveBeenCalled();
    expect(deps.outputChannel?.info).not.toHaveBeenCalled();
  });

  it("requests webview paste handling and reports provider failures", async () => {
    const successDeps = createDependencies();

    const successCommands = registerAndGetCommands(successDeps);
    await getCommand(successCommands, "ulw.paste")();

    expect(successDeps.provider?.requestPaste).toHaveBeenCalledTimes(1);
    expect(successDeps.outputChannel?.error).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const errorDeps = createDependencies();
    vi.mocked(errorDeps.provider!.requestPaste).mockImplementationOnce(() => {
      throw new Error("webview unavailable");
    });

    const errorCommands = registerAndGetCommands(errorDeps);
    await getCommand(errorCommands, "ulw.paste")();

    expect(errorDeps.outputChannel?.error).toHaveBeenCalledWith(
      "[TerminalProvider] Failed to paste: webview unavailable",
    );
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to paste from clipboard",
    );

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const noProviderDeps = createDependencies({ provider: undefined });
    const noProviderCommands = registerAndGetCommands(noProviderDeps);
    await getCommand(noProviderCommands, "ulw.paste")();

    expect(noProviderDeps.outputChannel?.error).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockAutoFocusOnSend(true);

    const stringErrorDeps = createDependencies();
    vi.mocked(stringErrorDeps.provider!.requestPaste).mockImplementationOnce(
      () => {
        throw "paste failed";
      },
    );

    const stringErrorCommands = registerAndGetCommands(stringErrorDeps);
    await getCommand(stringErrorCommands, "ulw.paste")();

    expect(stringErrorDeps.outputChannel?.error).toHaveBeenCalledWith(
      "[TerminalProvider] Failed to paste: paste failed",
    );
  });

  it("focuses the configured editor terminal, opens the terminal in an editor tab, and restores it to the sidebar", () => {
    mockConfiguration({ terminalDefaultLocation: "editor" });
    const deps = createDependencies();
    const commands = registerAndGetCommands(deps);

    getCommand(commands, "ulw.focus")();
    getCommand(commands, "ulw.openTerminalInEditor")();
    getCommand(commands, "ulw.restoreTerminalToSidebar")();

    expect(deps.provider?.focusAtConfiguredLocation).toHaveBeenCalledTimes(1);
    expect(deps.provider?.openInEditorTab).toHaveBeenCalledTimes(1);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "workbench.view.focus",
      "ulw",
    );
    expect(deps.provider?.toggleEditorAttachment).toHaveBeenCalledTimes(1);
  });

  it("focuses the secondary sidebar when terminal.defaultLocation is sidebar", () => {
    mockConfiguration({ terminalDefaultLocation: "sidebar" });
    const deps = createDependencies();
    const commands = registerAndGetCommands(deps);

    getCommand(commands, "ulw.focus")();

    expect(deps.provider?.focusAtConfiguredLocation).toHaveBeenCalledTimes(1);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "workbench.view.focus",
      "ulw",
    );
  });

  it("keeps explicit editor and restore commands independent of the default location", () => {
    mockConfiguration({ terminalDefaultLocation: "sidebar" });
    const deps = createDependencies();
    const commands = registerAndGetCommands(deps);

    getCommand(commands, "ulw.openTerminalInEditor")();
    getCommand(commands, "ulw.restoreTerminalToSidebar")();

    expect(deps.provider?.openInEditorTab).toHaveBeenCalledTimes(1);
    expect(deps.provider?.toggleEditorAttachment).toHaveBeenCalledTimes(1);
  });

  it("returns the provider focus promise from ulw.focus", () => {
    mockConfiguration({ terminalDefaultLocation: "sidebar" });
    const deps = createDependencies();
    const commands = registerAndGetCommands(deps);
    const focusCommand = getCommand(commands, "ulw.focus");
    const focusPromise = Promise.resolve();

    vi.mocked(deps.provider!.focusAtConfiguredLocation).mockReturnValueOnce(
      focusPromise,
    );

    const result = focusCommand();

    expect(result).toBeDefined();
    expect(result).toBe(focusPromise);
    expect(result).toHaveProperty("then");
  });
});
