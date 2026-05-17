import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeApi from "vscode";
import type * as vscodeTypes from "../test/mocks/vscode";
import type { MessageRouterProviderBridge } from "./MessageRouter";
import { MessageRouter } from "./MessageRouter";
import { OutputChannelService } from "../services/OutputChannelService";
import type { TerminalManager } from "../terminals/TerminalManager";
import type { OutputCaptureManager } from "../services/OutputCaptureManager";
import type { TerminalBackendType } from "../types";

const mockWriteFile = vi.hoisted(() =>
  vi.fn(async (file: string | Buffer | URL, data: unknown, options?: unknown) => {
    if (String(file).includes("/tmp/opencode-tests/")) {
      return undefined;
    }
    const fs = await import("node:fs");
    await fs.promises.writeFile(
      file,
      data as Parameters<typeof fs.promises.writeFile>[1],
      options as Parameters<typeof fs.promises.writeFile>[2],
    );
    return undefined;
  }),
);
const mockUnlink = vi.hoisted(() =>
  vi.fn(async (file: string | Buffer | URL) => {
    if (String(file).includes("/tmp/opencode-tests/")) {
      return undefined;
    }
    const fs = await import("node:fs");
    await fs.promises.unlink(file);
    return undefined;
  }),
);
const mockNormalize = vi.hoisted(() =>
  vi.fn((value: string) => value.replace(/\\/g, "/")),
);
const mockJoin = vi.hoisted(() =>
  vi.fn((...parts: string[]) => parts.join("/")),
);
const mockTmpdir = vi.hoisted(() => vi.fn(() => "/tmp/opencode-tests"));
const mockRandomUUID = vi.hoisted(() => vi.fn(() => "uuid-1234"));

vi.mock("fs", () => ({
  promises: {
    writeFile: mockWriteFile,
    unlink: mockUnlink,
  },
}));

vi.mock("path", () => ({
  join: mockJoin,
  normalize: mockNormalize,
}));

vi.mock("os", () => ({
  tmpdir: mockTmpdir,
}));

vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

type MockTerminal = {
  name: string;
  show: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
  shellIntegration?: { cwd?: { fsPath?: string } };
};

describe("MessageRouter", () => {
  let context: vscodeApi.ExtensionContext;
  let logger: OutputChannelService;
  let provider: MessageRouterProviderBridge;
  let terminalManager: Pick<
    TerminalManager,
    "writeToTerminal" | "resizeTerminal"
  >;
  let captureManager: Pick<OutputCaptureManager, "startCapture">;
  let router: MessageRouter;

  function createProviderBridge(): MessageRouterProviderBridge {
    return {
      startOpenCode: vi.fn(async () => undefined),
      switchToTmuxSession: vi.fn(async () => undefined),
      switchToZellijSession: vi.fn(async () => undefined),
      killTmuxSession: vi.fn(async () => undefined),
      createTmuxSession: vi.fn(async () => "tmux-new"),
      toggleDashboard: vi.fn(),
      toggleEditorAttachment: vi.fn(async () => undefined),
      restart: vi.fn(),
      switchToNativeShell: vi.fn(async () => undefined),
      selectTerminalBackend: vi.fn(async () => undefined),
      cycleTerminalBackend: vi.fn(async () => undefined),
      pasteText: vi.fn(),
      getActiveInstanceId: vi.fn(() => "instance-1"),
      getActiveTerminalId: vi.fn(() => "terminal-1"),
      setLastKnownTerminalSize: vi.fn(),
      getLastKnownTerminalSize: vi.fn(() => ({ cols: 120, rows: 40 })),
      isStarted: vi.fn(() => false),
      resizeActiveTerminal: vi.fn(),
      postWebviewMessage: vi.fn(),
      routeDroppedTextToTmuxPane: vi.fn(async () => false),
      formatDroppedFiles: vi.fn(
        (paths: string[], useAtSyntax: boolean) =>
          `${useAtSyntax ? "@" : ""}${paths.join(" ")}`,
      ),
      formatPastedImage: vi.fn((tempPath: string) => `@img:${tempPath}`),
      launchAiTool: vi.fn(async () => undefined),
      showAiToolSelector: vi.fn(async () => undefined),
      executeRawTmuxCommand: vi.fn(async () => ""),
      zoomTmuxPane: vi.fn(async () => undefined),
      getSelectedTmuxSessionId: vi.fn(() => "tmux-selected"),
      isTmuxAvailable: vi.fn(() => true),
      isZellijAvailable: vi.fn(() => true),
      getActiveBackend: vi.fn<() => TerminalBackendType>(() => "tmux"),
      getBackendAvailability: vi.fn(() => ({
        native: true,
        tmux: true,
        zellij: true,
      })),
    };
  }

  function createMockTerminal(name: string, cwd?: string): MockTerminal {
    return {
      name,
      show: vi.fn(),
      sendText: vi.fn(),
      shellIntegration: cwd ? { cwd: { fsPath: cwd } } : undefined,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    OutputChannelService.resetInstance();
    vi.useRealTimers();

    mockWriteFile.mockReset().mockImplementation(
      async (file: string | Buffer | URL, data: unknown, options?: unknown) => {
        if (String(file).includes("/tmp/opencode-tests/")) {
          return undefined;
        }
        const fs = await import("node:fs");
        await fs.promises.writeFile(
          file,
          data as Parameters<typeof fs.promises.writeFile>[1],
          options as Parameters<typeof fs.promises.writeFile>[2],
        );
        return undefined;
      },
    );
    mockUnlink.mockReset().mockImplementation(async (file: string | Buffer | URL) => {
      if (String(file).includes("/tmp/opencode-tests/")) {
        return undefined;
      }
      const fs = await import("node:fs");
      await fs.promises.unlink(file);
      return undefined;
    });
    mockNormalize
      .mockReset()
      .mockImplementation((value: string) => value.replace(/\\/g, "/"));
    mockJoin
      .mockReset()
      .mockImplementation((...parts: string[]) => parts.join("/"));
    mockTmpdir.mockReset().mockReturnValue("/tmp/opencode-tests");
    mockRandomUUID.mockReset().mockReturnValue("uuid-1234");

    Object.defineProperty(vscode, "Range", {
      configurable: true,
      value: class Range {
        public start: { line: number; character: number };
        public end: { line: number; character: number };

        public constructor(
          startLine: number,
          startChar: number,
          endLine: number,
          endChar: number,
        ) {
          this.start = { line: startLine, character: startChar };
          this.end = { line: endLine, character: endChar };
        }
      },
    });

    context =
      new vscode.ExtensionContext() as unknown as vscodeApi.ExtensionContext;
    logger = OutputChannelService.getInstance();
    provider = createProviderBridge();
    terminalManager = {
      writeToTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
    };
    captureManager = {
      startCapture: vi.fn(() => ({
        success: true,
        filePath: "/tmp/capture.log",
      })),
    };

    vscode.window.terminals = [];
    vscode.workspace.workspaceFolders = [
      {
        uri: vscode.Uri.file("/workspace"),
        name: "workspace",
        index: 0,
      },
    ];
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as never);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([]);

    router = new MessageRouter(
      provider,
      context,
      terminalManager as TerminalManager,
      captureManager as OutputCaptureManager,
      undefined,
      {} as never,
      logger,
      undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    OutputChannelService.resetInstance();
  });

  it("ignores invalid raw messages and routes terminal lifecycle dispatches", async () => {
    await router.handleMessage(undefined);
    await router.handleMessage("bad-payload");

    await router.handleMessage({ type: "terminalInput", data: "pwd\n" });
    await router.handleMessage({ type: "terminalResize", cols: 100, rows: 30 });
    await router.handleMessage({ type: "ready", cols: 80, rows: 25 });

    expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
      "terminal-1",
      "pwd\n",
    );
    expect(provider.setLastKnownTerminalSize).toHaveBeenCalledWith(100, 30);
    expect(terminalManager.resizeTerminal).toHaveBeenCalledWith(
      "terminal-1",
      100,
      30,
    );
    expect(provider.startOpenCode).toHaveBeenCalledTimes(1);
    expect(provider.postWebviewMessage).toHaveBeenCalledWith({
      type: "platformInfo",
      platform: process.platform,
      tmuxAvailable: true,
      zellijAvailable: true,
      backendAvailability: { native: true, tmux: true, zellij: true },
      activeBackend: "tmux",
    });
  });

  it("forwards Ctrl+C control bytes unchanged to the active terminal", async () => {
    await router.handleMessage({ type: "terminalInput", data: "\x03" });

    expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
      "terminal-1",
      "\x03",
    );
  });

  it("routes handleMessage cases for provider bridge actions and clipboard operations", async () => {
    vi.mocked(vscode.env.clipboard.readText).mockResolvedValue(
      "clipboard text",
    );

    await router.handleMessage({ type: "openUrl", url: "https://example.com" });
    await router.handleMessage({ type: "listTerminals" });
    await router.handleMessage({ type: "setClipboard", text: "copied" });
    await router.handleMessage({ type: "triggerPaste" });
    await router.handleMessage({ type: "switchSession", sessionId: "tmux-a" });
    await router.handleMessage({ type: "killSession", sessionId: "tmux-b" });
    await router.handleMessage({ type: "createTmuxSession" });
    await router.handleMessage({
      type: "launchAiTool",
      sessionId: "tmux-c",
      tool: "claude",
      savePreference: true,
      targetPaneId: "%1",
    });
    await router.handleMessage({
      type: "sendTmuxPromptChoice",
      choice: "tmux",
    });
    await router.handleMessage({
      type: "sendTmuxPromptChoice",
      choice: "shell",
    });
    await router.handleMessage({
      type: "sendTmuxPromptChoice",
      choice: "zellij",
    });
    await router.handleMessage({ type: "cycleTerminalBackend" });
    await router.handleMessage({ type: "requestAiToolSelector" });
    await router.handleMessage({
      type: "executeTmuxCommand",
      commandId: "opencodeTui.tmuxCreateWindow",
    });
    await router.handleMessage({ type: "toggleDashboard" });
    await router.handleMessage({ type: "toggleEditorAttachment" });
    await router.handleMessage({
      type: "openFile",
      path: "src/providers/MessageRouter.ts",
    });

    expect(vscode.env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({ scheme: "https" }),
    );
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith("copied");
    expect(provider.pasteText).toHaveBeenCalledWith("clipboard text");
    expect(provider.switchToTmuxSession).toHaveBeenCalledWith("tmux-a");
    expect(provider.killTmuxSession).toHaveBeenCalledWith("tmux-b");
    expect(provider.createTmuxSession).toHaveBeenCalledTimes(1);
    expect(provider.selectTerminalBackend).toHaveBeenCalledWith("tmux");
    expect(provider.selectTerminalBackend).toHaveBeenCalledWith("zellij");
    expect(provider.cycleTerminalBackend).toHaveBeenCalledTimes(1);
    expect(provider.switchToNativeShell).toHaveBeenCalledTimes(1);
    expect(provider.launchAiTool).toHaveBeenCalledWith(
      "tmux-c",
      "claude",
      true,
      "%1",
    );
    expect(provider.showAiToolSelector).toHaveBeenCalledWith(
      "tmux-selected",
      "tmux-selected",
      true,
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "opencodeTui.tmuxCreateWindow",
    );
    expect(provider.toggleDashboard).toHaveBeenCalledTimes(1);
    expect(provider.toggleEditorAttachment).toHaveBeenCalledTimes(1);
    expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
  });

  it("routes switchSession through zellij when zellij backend is active", async () => {
    provider.getActiveBackend = vi.fn<() => TerminalBackendType>(() => "zellij");

    await router.handleMessage({ type: "switchSession", sessionId: "zellij-a" });

    expect(provider.switchToZellijSession).toHaveBeenCalledWith("zellij-a");
    expect(provider.switchToTmuxSession).not.toHaveBeenCalled();
  });

  it("routes killSession through the backend-aware session runtime bridge for zellij", async () => {
    provider.getActiveBackend = vi.fn<() => TerminalBackendType>(() => "zellij");

    await router.handleMessage({ type: "killSession", sessionId: "zellij-b" });

    expect(provider.killTmuxSession).toHaveBeenCalledWith("zellij-b");
  });

  it("routes zoomTmuxPane through the backend-aware session runtime bridge for zellij", async () => {
    provider.getActiveBackend = vi.fn<() => TerminalBackendType>(() => "zellij");

    await router.handleMessage({ type: "zoomTmuxPane" });

    expect(provider.zoomTmuxPane).toHaveBeenCalledTimes(1);
  });

  it("routes filesDropped with shift and pane fallback or direct terminal writes", async () => {
    vi.mocked(vscode.workspace.asRelativePath).mockImplementation(
      (value: string) => value,
    );

    provider.routeDroppedTextToTmuxPane = vi
      .fn<MessageRouterProviderBridge["routeDroppedTextToTmuxPane"]>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    router.handleFilesDropped(
      [
        "file:///workspace/src/index.ts",
        "file:///workspace/src/index.ts",
        "/workspace/notes.md",
      ],
      true,
      { col: 4, row: 2 },
    );
    await Promise.resolve();

    router.handleFilesDropped(["/workspace/README.md"], true);
    router.handleFilesDropped(["/workspace/docs/guide.md"], false);

    expect(provider.formatDroppedFiles).toHaveBeenNthCalledWith(
      1,
      ["/workspace/src/index.ts", "/workspace/notes.md"],
      true,
    );
    expect(provider.routeDroppedTextToTmuxPane).toHaveBeenCalledWith(
      "@/workspace/src/index.ts /workspace/notes.md ",
      { col: 4, row: 2 },
    );
    expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
      "instance-1",
      "@/workspace/src/index.ts /workspace/notes.md ",
    );
    expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
      "instance-1",
      "@/workspace/README.md ",
    );
    expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
      "instance-1",
      "/workspace/docs/guide.md ",
    );
  });

  it("normalizes vscode-file:// URIs to absolute fsPath for outside-workspace files", async () => {
    vi.mocked(vscode.workspace.asRelativePath).mockImplementation(
      (value: string) => value,
    );
    vi.mocked(vscode.Uri.parse).mockImplementation((uri: string) => {
      if (uri.startsWith("vscode-file://")) {
        const pathname = decodeURIComponent(new URL(uri).pathname);
        return {
          fsPath: pathname,
          path: pathname,
          scheme: "vscode-file",
        } as any;
      }
      const match = uri.match(/^([a-z]+):\/\/(.+)$/);
      const p = match ? `/${match[2]}` : uri;
      return { fsPath: p, path: p, scheme: match?.[1] ?? "file" } as any;
    });

    router.handleFilesDropped(
      ["vscode-file:///outside/workspace/file.ts"],
      false,
    );

    expect(provider.formatDroppedFiles).toHaveBeenCalledWith(
      ["/outside/workspace/file.ts"],
      false,
    );
    expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
      "instance-1",
      "/outside/workspace/file.ts ",
    );
  });

  it("materializes blob fallback drops to secure temp files", async () => {
    vi.useFakeTimers();
    vi.mocked(vscode.workspace.asRelativePath).mockImplementation(
      (value: string) => value,
    );

    await router.handleFilesDropped([], false, undefined, [
      {
        name: "notes.txt",
        data: "data:text/plain;base64,SGVsbG8=",
      },
    ]);

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/opencode-tests/opencode-drop-uuid-1234-notes.txt",
      expect.any(Buffer),
      { flag: "wx", mode: 0o600 },
    );
    expect(provider.formatDroppedFiles).toHaveBeenCalledWith(
      ["/tmp/opencode-tests/opencode-drop-uuid-1234-notes.txt"],
      false,
    );
    expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
      "instance-1",
      "/tmp/opencode-tests/opencode-drop-uuid-1234-notes.txt ",
    );

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(mockUnlink).toHaveBeenCalledWith(
      "/tmp/opencode-tests/opencode-drop-uuid-1234-notes.txt",
    );
  });

  it("routes blob fallback drops through tmux pane formatting when shift is held", async () => {
    vi.mocked(vscode.workspace.asRelativePath).mockImplementation(
      (value: string) => value,
    );
    provider.routeDroppedTextToTmuxPane = vi
      .fn<MessageRouterProviderBridge["routeDroppedTextToTmuxPane"]>()
      .mockResolvedValueOnce(true);

    await router.handleFilesDropped([], true, { col: 2, row: 3 }, [
      {
        name: "image.png",
        data: "data:image/png;base64,aGVsbG8=",
      },
    ]);

    expect(provider.formatDroppedFiles).toHaveBeenCalledWith(
      ["/tmp/opencode-tests/opencode-drop-uuid-1234-image.png"],
      true,
    );
    expect(provider.routeDroppedTextToTmuxPane).toHaveBeenCalledWith(
      "@/tmp/opencode-tests/opencode-drop-uuid-1234-image.png ",
      { col: 2, row: 3 },
    );
  });

  it("rejects invalid blob fallback payloads", async () => {
    await router.handleFilesDropped([], false, undefined, [
      {
        name: "broken.txt",
        data: "not-a-data-url",
      },
    ]);

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(provider.formatDroppedFiles).not.toHaveBeenCalled();
    expect(terminalManager.writeToTerminal).not.toHaveBeenCalled();
  });

  it("handles image paste success and cleanup scheduling", async () => {
    vi.useFakeTimers();

    await router.handleImagePasted("data:image/png;base64,aGVsbG8=");

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/opencode-tests/opencode-clipboard-uuid-1234.png",
      expect.any(Buffer),
      { flag: "wx", mode: 0o600 },
    );
    expect(provider.formatPastedImage).toHaveBeenCalledWith(
      "/tmp/opencode-tests/opencode-clipboard-uuid-1234.png",
    );
    expect(provider.pasteText).toHaveBeenCalledWith(
      "@img:/tmp/opencode-tests/opencode-clipboard-uuid-1234.png",
    );

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(mockUnlink).toHaveBeenCalledWith(
      "/tmp/opencode-tests/opencode-clipboard-uuid-1234.png",
    );
  });

  it("rejects invalid image payload variants and write failures", async () => {
    mockWriteFile.mockRejectedValueOnce(new Error("disk full"));

    await router.handleImagePasted("not-a-data-url");
    await router.handleImagePasted("data:image/svg+xml;base64,aGVsbG8=");
    await router.handleImagePasted(
      `data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")}`,
    );
    await router.handleImagePasted("data:image/png;base64,aGVsbG8=");

    expect(provider.pasteText).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it("opens files directly, blocks traversal, and falls back to fuzzy matches", async () => {
    const matchedUri = vscode.Uri.file(
      "/workspace/src/providers/MessageRouter.ts",
    );
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([matchedUri]);
    vi.mocked(vscode.window.showTextDocument)
      .mockRejectedValueOnce(new Error("missing file"))
      .mockResolvedValue({} as never);

    await router.handleOpenFile("../secrets.txt");
    await router.handleOpenFile("src/providers/MessageRouter.ts", 5, 8, 3);
    await router.handleOpenFile("missing/file.ts", 2);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Invalid file path: Path traversal detected",
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fsPath: "/workspace/src/providers/MessageRouter.ts",
      }),
      {
        selection: {
          start: { line: 4, character: 2 },
          end: { line: 7, character: 9999 },
        },
        preview: true,
      },
    );
    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      "**/MessageRouter.ts*",
      null,
      100,
    );
  });

  it("reports open file failures when fuzzy matching cannot recover", async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([]);
    vi.mocked(vscode.window.showTextDocument).mockRejectedValue(
      new Error("cannot open"),
    );

    await router.handleOpenFile("missing/file.ts");

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to open file: missing/file.ts",
    );
  });

  it("lists terminals, skipping the sidebar terminal and handling missing cwd", async () => {
    const integratedTerminal = createMockTerminal("External A", "/workspace/a");
    const hiddenCwdTerminal = createMockTerminal("External B");
    const sidebarTerminal = createMockTerminal(
      "Open Sidebar Terminal",
      "/workspace/sidebar",
    );
    Object.defineProperty(hiddenCwdTerminal, "shellIntegration", {
      get() {
        throw new Error("cwd unavailable");
      },
    });

    vscode.window.terminals = [
      integratedTerminal,
      sidebarTerminal,
      hiddenCwdTerminal,
    ];

    const entries = await router.getTerminalEntries();
    await router.handleListTerminals();

    expect(entries).toEqual([
      { name: "External A", cwd: "/workspace/a" },
      { name: "External B", cwd: "" },
    ]);
    expect(provider.postWebviewMessage).toHaveBeenCalledWith({
      type: "terminalList",
      terminals: entries,
    });
  });

  it("handles sendCommandToTerminal permission flows", async () => {
    const terminal = createMockTerminal("External");

    vi.mocked(context.globalState.get).mockReturnValueOnce(true);
    await router.sendCommandToTerminal(terminal as never, "npm test");

    vi.mocked(context.globalState.get).mockReturnValueOnce(undefined);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
      "Yes" as never,
    );
    await router.sendCommandToTerminal(terminal as never, "npm lint");

    vi.mocked(context.globalState.get).mockReturnValueOnce(undefined);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
      "Yes, don't ask again" as never,
    );
    await router.sendCommandToTerminal(terminal as never, "npm build");

    vi.mocked(context.globalState.get).mockReturnValueOnce(undefined);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
      "No" as never,
    );
    await router.sendCommandToTerminal(terminal as never, "npm denied");

    expect(terminal.sendText).toHaveBeenNthCalledWith(1, "npm test");
    expect(terminal.sendText).toHaveBeenNthCalledWith(2, "npm lint");
    expect(terminal.sendText).toHaveBeenNthCalledWith(3, "npm build");
    expect(context.globalState.update).toHaveBeenCalledWith(
      "opencodeTui.allowTerminalCommands",
      true,
    );
    expect(terminal.sendText).toHaveBeenCalledTimes(3);
  });

  it("starts terminal capture with success and failure feedback", () => {
    const terminal = createMockTerminal("CaptureMe");

    router.startTerminalCapture(terminal as never, "CaptureMe");
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "Started capturing terminal: CaptureMe",
    );

    captureManager.startCapture = vi.fn(() => ({
      success: false,
      error: "script missing",
    }));
    router = new MessageRouter(
      provider,
      context,
      terminalManager as TerminalManager,
      captureManager as OutputCaptureManager,
      undefined,
      {} as never,
      logger,
      undefined,
    );

    router.startTerminalCapture(terminal as never, "CaptureMe");
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to start capture: script missing",
    );
  });

  it("creates selections for single-line and multi-line requests", () => {
    expect(router.createSelection()).toBeUndefined();
    expect(router.createSelection(3, undefined, 2)).toEqual({
      start: { line: 2, character: 1 },
      end: { line: 2, character: 1 },
    });
    expect(router.createSelection(3, 6, 2)).toEqual({
      start: { line: 2, character: 1 },
      end: { line: 5, character: 9999 },
    });
  });

  it("fuzzy matches files, prefers exact suffixes, and handles workspace or search failures", async () => {
    const deeper = vscode.Uri.file("/workspace/src/providers/MessageRouter.ts");
    const nearby = vscode.Uri.file("/workspace/MessageRouter.ts.backup");
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([nearby, deeper]);

    const match = await router.fuzzyMatchFile("src/providers/MessageRouter.ts");
    expect(match).toEqual(deeper);

    vscode.workspace.workspaceFolders = undefined;
    expect(
      await router.fuzzyMatchFile("src/providers/MessageRouter.ts"),
    ).toBeNull();

    vscode.workspace.workspaceFolders = [
      {
        uri: vscode.Uri.file("/workspace"),
        name: "workspace",
        index: 0,
      },
    ];
    vi.mocked(vscode.workspace.findFiles).mockRejectedValueOnce(
      new Error("search failed"),
    );

    expect(
      await router.fuzzyMatchFile("src/providers/MessageRouter.ts"),
    ).toBeNull();
  });

  it("handles ready for started sessions and invalid resize or paste errors", async () => {
    provider.isStarted = vi.fn(() => true);
    provider.getLastKnownTerminalSize = vi.fn(() => ({ cols: 132, rows: 44 }));
    vi.mocked(vscode.env.clipboard.readText).mockRejectedValueOnce(
      new Error("clipboard down"),
    );
    vi.mocked(vscode.env.clipboard.writeText).mockRejectedValueOnce(
      new Error("write denied"),
    );

    router.handleTerminalInput(undefined);
    router.handleTerminalResize(undefined, 24);
    router.handleReady(undefined, undefined);
    await router.handlePaste();
    await router.handleSetClipboard("x");

    expect(provider.resizeActiveTerminal).toHaveBeenCalledWith(132, 44);
    expect(terminalManager.writeToTerminal).not.toHaveBeenCalled();
    expect(terminalManager.resizeTerminal).not.toHaveBeenCalled();
    expect(provider.postWebviewMessage).toHaveBeenCalledWith({
      type: "platformInfo",
      platform: process.platform,
      tmuxAvailable: true,
      zellijAvailable: true,
      backendAvailability: { native: true, tmux: true, zellij: true },
      activeBackend: "tmux",
    });
  });

  it("logs bridge errors for tmux actions", async () => {
    provider.zoomTmuxPane = vi.fn(async () => {
      throw new Error("zoom boom");
    });

    const errorSpy = vi.spyOn(logger, "error");

    await router.handleMessage({ type: "zoomTmuxPane" });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("zoomTmuxPane failed: zoom boom"),
    );
  });

  it("ignores unsupported tmux command ids and logs execute failures", async () => {
    const errorSpy = vi.spyOn(logger, "error");
    vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce(
      new Error("command boom"),
    );

    await router.handleMessage({
      type: "executeTmuxCommand",
      commandId: "opencodeTui.tmuxNextWindow",
    });
    await router.handleMessage({
      type: "executeTmuxCommand",
      commandId: "opencodeTui.invalidCommand" as never,
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "opencodeTui.tmuxNextWindow",
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "executeTmuxCommand failed for opencodeTui.tmuxNextWindow: command boom",
      ),
    );
  });

  it("routes supported raw tmux commands and ignores invalid payloads", async () => {
    const rawSpy = vi.spyOn(provider, "executeRawTmuxCommand");

    await router.handleMessage({
      type: "executeTmuxRawCommand",
      subcommand: "rename-session",
      args: ["repo-next"],
    });
    await router.handleMessage({
      type: "executeTmuxRawCommand",
      subcommand: "not-supported",
      args: ["ignored"],
    });
    await router.handleMessage({
      type: "executeTmuxRawCommand",
      subcommand: "choose-tree",
      args: [123],
    });

    expect(rawSpy).toHaveBeenCalledTimes(1);
    expect(rawSpy).toHaveBeenCalledWith("rename-session", ["repo-next"]);
  });

  it("logs raw tmux bridge failures", async () => {
    provider.executeRawTmuxCommand = vi.fn(async () => {
      throw new Error("raw boom");
    });
    const errorSpy = vi.spyOn(logger, "error");

    await router.handleMessage({
      type: "executeTmuxRawCommand",
      subcommand: "choose-tree",
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "executeTmuxRawCommand failed for choose-tree: raw boom",
      ),
    );
  });

  it("covers ignored message payload branches and restart/select dispatch", async () => {
    await router.handleMessage({ type: "filesDropped" });
    await router.handleMessage({ type: "openUrl", url: 123 });
    await router.handleMessage({ type: "openFile", path: 123 });
    await router.handleMessage({ type: "setClipboard", text: 123 });
    await router.handleMessage({ type: "imagePasted", data: 123 });
    await router.handleMessage({ type: "selectTerminalBackend", backend: "native" });
    await router.handleMessage({ type: "requestRestart" });
    await router.handleMessage({ type: "unknownMessage" });

    expect(provider.selectTerminalBackend).toHaveBeenCalledWith("native");
    expect(provider.restart).toHaveBeenCalledTimes(1);
    expect(provider.formatDroppedFiles).not.toHaveBeenCalled();
  });

  it("keeps create-session and raw-command behavior backend aware for zellij", async () => {
    provider.getActiveBackend = vi.fn<() => TerminalBackendType>(() => "zellij");
    const warnSpy = vi.spyOn(logger, "warn");

    await router.handleMessage({ type: "createTmuxSession" });
    await router.handleMessage({ type: "executeTmuxRawCommand", subcommand: "choose-tree" });

    expect(provider.selectTerminalBackend).toHaveBeenCalledWith("zellij");
    expect(provider.createTmuxSession).not.toHaveBeenCalled();
    expect(provider.executeRawTmuxCommand).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("executeTmuxRawCommand ignored for zellij backend"),
    );
  });

  it("handles ready without saved dimensions and non-string tmux prompt choices", () => {
    provider.isStarted = vi.fn(() => true);
    provider.getLastKnownTerminalSize = vi.fn(() => ({ cols: 0, rows: 0 }));

    router.handleReady(90, 0);

    expect(provider.setLastKnownTerminalSize).toHaveBeenCalledWith(90, 0);
    expect(provider.resizeActiveTerminal).not.toHaveBeenCalled();
  });

  it("opens file URI and absolute paths and reports outer path failures", async () => {
    vi.mocked(vscode.Uri.parse).mockImplementationOnce(() => {
      throw new Error("parse failed");
    });
    await router.handleOpenFile("safe-file.ts");
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to open file: safe-file.ts",
    );

    await router.handleOpenFile("file:///workspace/absolute.ts", 1, undefined, 1);
    await router.handleOpenFile("C:\\workspace\\absolute.ts");

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "file:///workspace/absolute.ts" }),
      expect.objectContaining({ preview: true }),
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "C:\\workspace\\absolute.ts" }),
      expect.objectContaining({ preview: true }),
    );
  });

  it("handles empty drops, malformed URI drops, oversize blobs, and blob write errors", async () => {
    vi.mocked(vscode.Uri.parse).mockImplementationOnce(() => {
      throw new Error("bad uri");
    });
    await router.handleFilesDropped(["file://bad-uri"], false);
    expect(provider.formatDroppedFiles).toHaveBeenCalledWith(["file://bad-uri"], false);

    vi.clearAllMocks();
    await router.handleFilesDropped([], false);
    expect(provider.formatDroppedFiles).not.toHaveBeenCalled();

    await router.handleFilesDropped([], false, undefined, [
      {
        name: "huge.png",
        data: `data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")}`,
      },
    ]);
    expect(mockWriteFile).not.toHaveBeenCalled();

    mockWriteFile.mockRejectedValueOnce(new Error("write failed"));
    await router.handleFilesDropped([], false, undefined, [
      { name: "../bad name?.png", data: "data:image/png;base64,aGVsbG8=" },
    ]);
    expect(provider.formatDroppedFiles).not.toHaveBeenCalled();
  });

  it("logs cleanup failures for temporary pasted images", async () => {
    vi.useFakeTimers();
    mockUnlink.mockRejectedValueOnce(new Error("unlink failed"));
    const warnSpy = vi.spyOn(logger, "warn");

    await router.handleImagePasted("data:image/png;base64,aGVsbG8=");
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to cleanup temp file: unlink failed"),
    );
  });

  it("fuzzy match sort prefers second exact suffix and matching directory parts", async () => {
    const first = vscode.Uri.file("/workspace/tmp/MessageRouter.ts.backup");
    const exact = vscode.Uri.file("/workspace/src/providers/MessageRouter.ts");
    vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([first, exact]);

    expect(await router.fuzzyMatchFile("src/providers/MessageRouter.ts")).toEqual(
      exact,
    );

    const wrongDir = vscode.Uri.file("/workspace/other/providers/MessageRouter.tsx");
    const matchingDir = vscode.Uri.file("src/providers/MessageRouter.tsx");
    vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([
      wrongDir,
      matchingDir,
    ]);

    expect(await router.fuzzyMatchFile("src/providers/MessageRouter.tsx")).toEqual(
      matchingDir,
    );
  });

  it("routes zellij session switches and ignores malformed session messages", async () => {
    provider.getActiveBackend = vi.fn<() => TerminalBackendType>(() => "zellij");

    await router.handleMessage({ type: "switchSession", sessionId: "zellij-a" });
    await router.handleMessage({ type: "switchSession", sessionId: 42 });
    await router.handleMessage({ type: "killSession", sessionId: 42 });
    await router.handleMessage({ type: "sendTmuxPromptChoice", choice: "ignored" });

    expect(provider.switchToZellijSession).toHaveBeenCalledWith("zellij-a");
    expect(provider.switchToTmuxSession).not.toHaveBeenCalled();
    expect(provider.killTmuxSession).not.toHaveBeenCalled();
    expect(provider.selectTerminalBackend).not.toHaveBeenCalled();
    expect(provider.switchToNativeShell).not.toHaveBeenCalled();
  });

  it("logs non-Error command failures with stringified messages", async () => {
    vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce("command down");
    provider.executeRawTmuxCommand = vi.fn().mockRejectedValueOnce("raw down");
    const errorSpy = vi.spyOn(logger, "error");

    await router.handleMessage({
      type: "executeTmuxCommand",
      commandId: "opencodeTui.tmuxCreateWindow",
    });
    await router.handleMessage({
      type: "executeTmuxRawCommand",
      subcommand: "rename-window",
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("command down"),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("raw down"));
    errorSpy.mockRestore();
  });

  it("resolves direct, absolute, relative, and fallback file paths", async () => {
    const originalFolders = vscode.workspace.workspaceFolders;
    vi.mocked(vscode.Uri.parse).mockImplementation((uri: string) => {
      const match = uri.match(/^([a-z]+):\/\/(.+)$/);
      return new vscode.Uri(
        match ? match[2] : uri,
        match ? match[2] : uri,
        match ? match[1] : "",
      );
    });

    await router.handleOpenFile("file:///workspace/from-uri.ts");
    await router.handleOpenFile("/workspace/absolute.ts");
    await router.handleOpenFile("C:\\workspace\\absolute.ts");
    await router.handleOpenFile("relative/no-workspace.ts");
    vscode.workspace.workspaceFolders = undefined;
    await router.handleOpenFile("relative/no-folder.ts");
    vscode.workspace.workspaceFolders = [];
    await router.handleOpenFile("relative/empty-folder.ts");
    vscode.workspace.workspaceFolders = originalFolders;

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "file:///workspace/from-uri.ts" }),
      expect.objectContaining({ preview: true }),
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/workspace/absolute.ts" }),
      expect.objectContaining({ preview: true }),
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "C:\\workspace\\absolute.ts" }),
      expect.objectContaining({ preview: true }),
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/workspace/relative/no-workspace.ts" }),
      expect.objectContaining({ preview: true }),
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "relative/no-folder.ts" }),
      expect.objectContaining({ preview: true }),
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "relative/empty-folder.ts" }),
      expect.objectContaining({ preview: true }),
    );
  });

  it("covers empty paste, unformatted images, sanitized blob fallbacks, and capture fallbacks", async () => {
    vi.mocked(vscode.env.clipboard.readText).mockResolvedValueOnce("");
    await router.handlePaste();
    expect(provider.pasteText).not.toHaveBeenCalled();

    provider.formatPastedImage = vi.fn(() => undefined);
    await router.handleImagePasted("data:image/png;base64,aGVsbG8=");
    expect(provider.pasteText).not.toHaveBeenCalled();

    mockRandomUUID.mockReturnValueOnce("drop-empty").mockReturnValueOnce("drop-bad");
    await router.handleFilesDropped([], false, undefined, [
      { name: "   ", data: "data:image/png;base64,aGVsbG8=" },
      { name: "folder/???.png", data: "data:image/png;base64,aGVsbG8=" },
    ]);
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/opencode-tests/opencode-drop-drop-empty-dropped-file",
      expect.any(Buffer),
      { flag: "wx", mode: 0o600 },
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/opencode-tests/opencode-drop-drop-bad-___.png",
      expect.any(Buffer),
      { flag: "wx", mode: 0o600 },
    );

    captureManager.startCapture = vi.fn(() => ({ success: false }));
    router.startTerminalCapture(
      createMockTerminal("External") as unknown as vscodeApi.Terminal,
      "External",
    );
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to start capture: Unknown error",
    );
  });

  it("sorts fuzzy matches through every comparator branch and logs string errors", async () => {
    const errorSpy = vi.spyOn(logger, "error");
    const exactFirst = vscode.Uri.file("/workspace/tmp/MessageRouter.ts");
    const exactSecond = vscode.Uri.file(
      "/workspace/src/providers/MessageRouter.ts",
    );
    vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([
      exactFirst,
      exactSecond,
    ]);
    expect(await router.fuzzyMatchFile("src/providers/MessageRouter.ts")).toEqual(
      exactSecond,
    );
    vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([
      exactSecond,
      exactFirst,
    ]);
    expect(await router.fuzzyMatchFile("src/providers/MessageRouter.ts")).toEqual(
      exactSecond,
    );

    const firstDirMatch = vscode.Uri.file("src/other/MessageRouter.ts");
    const secondDirMatch = vscode.Uri.file("other/src/MessageRouter.ts");
    const neutral = vscode.Uri.file("other/place/MessageRouter.ts");
    vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([
      secondDirMatch,
      firstDirMatch,
      neutral,
    ]);
    expect(await router.fuzzyMatchFile("src/providers/MessageRouter.ts")).toEqual(
      firstDirMatch,
    );
    vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([
      firstDirMatch,
      secondDirMatch,
      neutral,
    ]);
    expect(await router.fuzzyMatchFile("src/providers/MessageRouter.ts")).toEqual(
      firstDirMatch,
    );

    vi.mocked(vscode.workspace.findFiles).mockRejectedValueOnce("find failed");
    expect(await router.fuzzyMatchFile("src/providers/MessageRouter.ts")).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Fuzzy match failed: find failed"),
    );
    errorSpy.mockRestore();
  });

  it("covers defensive non-Error and fallback branches", async () => {
    const errorSpy = vi.spyOn(logger, "error");
    const warnSpy = vi.spyOn(logger, "warn");

    provider.zoomTmuxPane = vi.fn().mockRejectedValueOnce("zoom down");
    await router.handleMessage({ type: "zoomTmuxPane" });

    vi.mocked(vscode.env.clipboard.readText).mockRejectedValueOnce("paste down");
    await router.handlePaste();
    vi.mocked(vscode.env.clipboard.writeText).mockRejectedValueOnce("clip down");
    await router.handleSetClipboard("text");

    mockWriteFile.mockRejectedValueOnce("image down");
    await router.handleImagePasted("data:image/png;base64,aGVsbG8=");

    mockWriteFile.mockRejectedValueOnce("blob down");
    await router.handleFilesDropped([], false, undefined, [
      { name: "blob.png", data: "data:image/png;base64,aGVsbG8=" },
    ]);

    vi.useFakeTimers();
    mockUnlink.mockRejectedValueOnce("unlink down");
    await router.handleImagePasted("data:image/png;base64,aGVsbG8=");
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const sanitized = (
      router as unknown as {
        sanitizeDroppedBlobFileName: (name: string) => string;
      }
    ).sanitizeDroppedBlobFileName({
      split: () => [{ trim: () => ({ replace: () => "" }) }],
    } as unknown as string);

    vscode.window.terminals = [
      {
        name: "No Cwd",
        show: vi.fn(),
        sendText: vi.fn(),
        shellIntegration: { cwd: {} },
      } as unknown as vscodeApi.Terminal,
    ];
    expect(await router.getTerminalEntries()).toEqual([{ name: "No Cwd", cwd: "" }]);

    expect(sanitized).toBe("dropped-file");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("zoom down"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("paste down"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("clip down"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("image down"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("blob down"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unlink down"));
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

});
