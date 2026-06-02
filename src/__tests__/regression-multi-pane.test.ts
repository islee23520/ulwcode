import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeApi from "vscode";
import type * as nodePtyTypes from "../test/mocks/node-pty";
import type * as vscodeTypes from "../test/mocks/vscode";
import { ExtensionLifecycle } from "../core/ExtensionLifecycle";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { OutputChannelService } from "../services/OutputChannelService";
import { PortManager } from "../services/PortManager";
import { TerminalManager } from "../terminals/TerminalManager";
import { TerminalProvider } from "../providers/TerminalProvider";
import { DEFAULT_AI_TOOLS } from "../types";

const vscode = await vi.importActual<typeof vscodeTypes>("../test/mocks/vscode");
await vi.importActual<typeof nodePtyTypes>("../test/mocks/node-pty");

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

vi.mock("node-pty", async () => {
  const actual = await vi.importActual("../test/mocks/node-pty");
  return actual;
});

interface MockConfigOptions {
  autoStartOnOpen?: boolean;
  enableHttpApi?: boolean;
  autoShareContext?: boolean;
  defaultAiTool?: string;
  aiTools?: readonly unknown[];
  promptAiToolOnSession?: boolean;
}

describe("multi-pane regression coverage", () => {
  let terminalManager: TerminalManager;
  let captureManager: OutputCaptureManager;
  let provider: TerminalProvider | undefined;
  let lifecycle: ExtensionLifecycle | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    OutputChannelService.resetInstance();
    PortManager.resetInstance();
    terminalManager = new TerminalManager();
    captureManager = new OutputCaptureManager();
    vscode.workspace.workspaceFolders = undefined;
  });

  afterEach(async () => {
    provider?.dispose();
    if (lifecycle) {
      await lifecycle.deactivate();
    }
    terminalManager.dispose();
    OutputChannelService.resetInstance();
    PortManager.resetInstance();
  });

  function mockConfiguration(options?: MockConfigOptions) {
    const {
      autoStartOnOpen = false,
      enableHttpApi = false,
      autoShareContext = true,
      defaultAiTool = "opencode",
      aiTools = DEFAULT_AI_TOOLS,
      promptAiToolOnSession = false,
    } = options ?? {};

    const configuration = {
      get: vi.fn(<T,>(key: string, defaultValue?: T): T => {
        if (key === "autoStartOnOpen") {
          return autoStartOnOpen as T;
        }
        if (key === "enableHttpApi") {
          return enableHttpApi as T;
        }
        if (key === "autoShareContext") {
          return autoShareContext as T;
        }
        if (key === "defaultAiTool") {
          return defaultAiTool as T;
        }
        if (key === "aiTools") {
          return aiTools as T;
        }
        if (key === "httpTimeout") {
          return 5000 as T;
        }
        if (key === "logLevel") {
          return "error" as T;
        }
        if (key === "promptAiToolOnSession") {
          return promptAiToolOnSession as T;
        }
        if (key === "collapseSecondaryBarOnEditorOpen") {
          return false as T;
        }
        if (key === "fontSize") {
          return 14 as T;
        }
        if (key === "fontFamily") {
          return "monospace" as T;
        }
        if (key === "cursorBlink") {
          return true as T;
        }
        if (key === "cursorStyle") {
          return "block" as T;
        }
        if (key === "scrollback") {
          return 10000 as T;
        }
        if (key === "sendKeybindingsToShell") {
          return true as T;
        }
        if (key === "showTmuxWindowControls") {
          return true as T;
        }
        if (key === "shellPath") {
          return "" as T;
        }
        if (key === "shellArgs") {
          return [] as unknown as T;
        }
        return defaultValue as T;
      }),
      inspect: vi.fn(() => undefined),
      update: vi.fn(async () => undefined),
    };

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
      configuration as unknown as ReturnType<typeof vscode.workspace.getConfiguration>,
    );

    return configuration;
  }

  function createProvider(options?: {
    tmuxSessionManager?: TmuxSessionManager;
    zellijSessionManager?: any;
  }): TerminalProvider {
    const context = new vscode.ExtensionContext();
    const portManager = PortManager.getInstance();
    return new TerminalProvider(
      context as unknown as vscodeApi.ExtensionContext,
      terminalManager,
      captureManager,
      portManager,
      undefined,
      options?.tmuxSessionManager,
      options?.zellijSessionManager,
    );
  }

  function resolveProvider(target: TerminalProvider) {
    const view = vscode.WebviewView();
    target.resolveWebviewView(
      view as unknown as vscodeApi.WebviewView,
      {} as unknown as vscodeApi.WebviewViewResolveContext,
      {} as unknown as vscodeApi.CancellationToken,
    );

    const handlerCall = vi.mocked(view.webview.onDidReceiveMessage).mock.calls[0];
    expect(handlerCall).toBeDefined();

    return {
      view,
      messageHandler: handlerCall?.[0] as (message: unknown) => void,
    };
  }

  async function flushAsyncStartup(): Promise<void> {
    for (let index = 0; index < 12; index += 1) {
      await Promise.resolve();
    }
  }

  it("keeps extension activation wired to a single default pane view", async () => {
    mockConfiguration({ autoStartOnOpen: true, enableHttpApi: false });
    lifecycle = new ExtensionLifecycle();
    const context = new vscode.ExtensionContext();

    await lifecycle.activate(
      context as unknown as vscodeApi.ExtensionContext,
    );

    const providerRegistration = vi
      .mocked(vscode.window.registerWebviewViewProvider)
      .mock.calls.find((call) => call[0] === "opencodeTui");

    expect(providerRegistration).toBeDefined();

    const activatedProvider = providerRegistration?.[1] as TerminalProvider;
    const { messageHandler } = resolveProvider(activatedProvider);
    messageHandler({ type: "ready", cols: 120, rows: 34 });
    await flushAsyncStartup();

    expect(activatedProvider["sessionRuntime"].getLastKnownTerminalSize()).toEqual(
      {
        cols: 120,
        rows: 34,
      },
    );
    expect(activatedProvider["paneStore"].getAllPanes().size).toBe(1);
    expect(activatedProvider["paneStore"].getPane("default")).toEqual(
      expect.objectContaining({
        paneId: "default",
        tabId: "default",
        isActive: true,
      }),
    );
  });

  it("preserves terminal input/output on the backward-compatible default pane", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const { view, messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 80, rows: 24 });
    await flushAsyncStartup();

    const terminal = terminalManager.getTerminal("opencode-main");
    expect(terminal).toBeDefined();

    messageHandler({ type: "terminalInput", data: "echo regression\n" });

    const mockProcess = terminal?.process as unknown as nodePtyTypes.MockPtyProcess;
    expect(mockProcess.write).toHaveBeenCalledWith("echo regression\n");

    vi.mocked(view.webview.postMessage).mockClear();
    mockProcess._simulateData("regression ok\r\n");
    await flushAsyncStartup();

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: "terminalOutput",
      data: "regression ok\r\n",
      paneId: "default",
    });
  });

  it("still sends dropped file paths to the default pane using shell quotes", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const writeSpy = vi.spyOn(terminalManager, "writeToTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 100, rows: 32 });
    await flushAsyncStartup();
    messageHandler({
      type: "filesDropped",
      files: ["/tmp/regression.ts"],
      shiftKey: true,
      paneId: "default",
    });
    await flushAsyncStartup();

    expect(writeSpy).toHaveBeenCalledWith("opencode-main", "'/tmp/regression.ts' ");
  });

  it("enables pane creation for the tmux backend (Phase 2: all backends support multi-pane)", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const runtime = provider["sessionRuntime"];
    const createSessionSpy = vi.spyOn(runtime, "createSession").mockResolvedValue(undefined);
    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("tmux");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "paneCreate", paneId: "tmux-pane" });
    await flushAsyncStartup();

    expect(createSessionSpy).toHaveBeenCalledWith("tmux-pane", expect.objectContaining({ backend: "tmux" }));
  });

  it("enables pane creation for the zellij backend (Phase 2: all backends support multi-pane)", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const runtime = provider["sessionRuntime"];
    const createSessionSpy = vi.spyOn(runtime, "createSession").mockResolvedValue(undefined);
    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("zellij");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "paneCreate", paneId: "zellij-pane" });
    await flushAsyncStartup();

    expect(createSessionSpy).toHaveBeenCalledWith("zellij-pane", expect.objectContaining({ backend: "zellij" }));
  });

  it("allows native multi-pane sessions while keeping resize behavior intact for all visible panes", async () => {
    mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const runtime = provider["sessionRuntime"];
    vi.spyOn(runtime, "getActiveBackend").mockReturnValue("native");
    const resizeSpy = vi.spyOn(terminalManager, "resizeTerminal");
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 96, rows: 28 });
    await flushAsyncStartup();
    messageHandler({
      type: "paneCreate",
      paneId: "pane-2",
      direction: "vertical",
    });
    await flushAsyncStartup();

    expect(provider["paneStore"].getPane("pane-2")).toEqual(
      expect.objectContaining({
        paneId: "pane-2",
        tabId: "default",
        splitDirection: "vertical",
      }),
    );
    expect(runtime.getSession("pane-2")).toEqual(
      expect.objectContaining({
        paneId: "pane-2",
        terminalKey: "pane-2",
        backend: "native",
      }),
    );

    messageHandler({ type: "terminalResize", cols: 120, rows: 40 });
    messageHandler({
      type: "terminalResize",
      cols: 88,
      rows: 22,
      paneId: "pane-2",
    });

    expect(resizeSpy).toHaveBeenCalledWith("opencode-main", 120, 40);
    expect(resizeSpy).toHaveBeenCalledWith("pane-2", 88, 22);
  });

  it("keeps HTTP append-prompt communication and auto-share context working in single-pane mode", async () => {
    mockConfiguration({
      autoStartOnOpen: false,
      enableHttpApi: true,
      autoShareContext: true,
    });
    provider = createProvider();
    const runtime = provider["sessionRuntime"];
    const apiHealthSpy = vi
      .spyOn(OpenCodeApiClient.prototype, "healthCheck")
      .mockResolvedValue(true);
    const apiAppendSpy = vi
      .spyOn(OpenCodeApiClient.prototype, "appendPrompt")
      .mockResolvedValue(undefined);

    const operator = {
      getLaunchCommand: vi.fn(() => "opencode -c"),
      supportsHttpApi: vi.fn(() => true),
      supportsAutoContext: vi.fn(() => true),
      formatFileReference: vi.fn(
        (reference: { path: string; selectionStart?: number; selectionEnd?: number }) =>
          `@${reference.path}#L${reference.selectionStart}-L${reference.selectionEnd}`,
      ),
    };

    vi.spyOn(runtime["aiToolRegistry"], "getForConfig").mockReturnValue(
      operator as never,
    );
    vi.spyOn(runtime["contextSharingService"], "getCurrentContext").mockReturnValue({
      filePath: "src/regression.ts",
      selectionStart: 10,
      selectionEnd: 20,
    });
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 110, rows: 36 });
    await flushAsyncStartup();

    expect(apiHealthSpy).toHaveBeenCalled();
    expect(apiAppendSpy).toHaveBeenCalledWith("@src/regression.ts#L10-L20");
    expect(provider.isHttpAvailable()).toBe(true);
  });

  it("keeps the legacy default session identity when no pane settings exist in config", async () => {
    const config = mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
    provider = createProvider();
    const editor = new vscode.TextEditor(
      new vscode.TextDocument(vscode.Uri.file("src/legacy.ts"), "content"),
      new vscode.Selection(9, 0, 19, 0),
    );
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 90, rows: 30 });
    await flushAsyncStartup();

    expect(config.get).not.toHaveBeenCalledWith("paneLayout", expect.anything());
    expect(provider["paneStore"].getAllPanes().size).toBe(1);
    expect(provider["sessionRuntime"].getActiveTerminalId()).toBe("opencode-main");
    expect(provider["sessionRuntime"].getSession("default")).toEqual(
      expect.objectContaining({
        paneId: "default",
        instanceId: "opencode-main",
        terminalKey: "opencode-main",
      }),
    );
    expect(provider.formatEditorReference(editor)).toBe("@src/legacy.ts#L10-L20");
  });

  describe("Phase 2: Backend Integration Regression", () => {
    it("Native multi-pane still works after backend integration", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      provider = createProvider();
      const runtime = provider["sessionRuntime"];
      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("native");
      const { messageHandler } = resolveProvider(provider);

      messageHandler({ type: "ready", cols: 100, rows: 30 });
      await flushAsyncStartup();

      messageHandler({ type: "paneCreate", paneId: "pane-1" });
      messageHandler({ type: "paneCreate", paneId: "pane-2" });
      messageHandler({ type: "paneCreate", paneId: "pane-3" });
      await flushAsyncStartup();

      expect(provider["paneStore"].getAllPanes().size).toBe(4);
      ["default", "pane-1", "pane-2", "pane-3"].forEach(id => {
        expect(runtime.getSession(id)).toEqual(
          expect.objectContaining({ backend: "native" })
        );
      });
    });

    it("Tmux backend pane creation", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      const tmuxSessionManager = { isAvailable: () => true } as any;
      provider = createProvider({ tmuxSessionManager });
      const runtime = provider["sessionRuntime"];
      const createSessionSpy = vi.spyOn(runtime, "createSession").mockResolvedValue(undefined);
      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("tmux");
      const { messageHandler } = resolveProvider(provider);

      messageHandler({ type: "paneCreate", paneId: "tmux-pane" });
      await flushAsyncStartup();

      expect(createSessionSpy).toHaveBeenCalledWith("tmux-pane", expect.objectContaining({ backend: "tmux" }));
    });

    it("Zellij backend pane creation", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      const zellijSessionManager = { isAvailable: () => true } as any;
      provider = createProvider({ zellijSessionManager });
      const runtime = provider["sessionRuntime"];
      const createSessionSpy = vi.spyOn(runtime, "createSession").mockResolvedValue(undefined);
      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("zellij");
      const { messageHandler } = resolveProvider(provider);

      messageHandler({ type: "paneCreate", paneId: "zellij-pane" });
      await flushAsyncStartup();

      expect(createSessionSpy).toHaveBeenCalledWith("zellij-pane", expect.objectContaining({ backend: "zellij" }));
    });

    it("Mixed backend panes", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      const tmuxSessionManager = {
        isAvailable: () => true,
        ensureSession: vi.fn().mockResolvedValue({ action: "attached", session: { id: "tmux-s" } }),
      } as any;
      provider = createProvider({ tmuxSessionManager });
      const runtime = provider["sessionRuntime"];
      const { messageHandler } = resolveProvider(provider);

      messageHandler({ type: "ready", cols: 100, rows: 30 });
      await flushAsyncStartup();

      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("native");
      messageHandler({ type: "paneCreate", paneId: "native-pane" });
      await flushAsyncStartup();

      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("tmux");
      vi.spyOn(runtime, "getSession").mockImplementation((paneId) => {
        if (paneId === "default") return { tmuxSessionId: "tmux-s" } as any;
        if (paneId === "native-pane") return { backend: "native" } as any;
        if (paneId === "tmux-pane") return { backend: "tmux" } as any;
        return undefined;
      });
      messageHandler({ type: "paneCreate", paneId: "tmux-pane" });
      await flushAsyncStartup();

      expect(runtime.getSession("native-pane")?.backend).toBe("native");
      expect(runtime.getSession("tmux-pane")?.backend).toBe("tmux");
    });

    it("Backend switch preserves pane", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      const tmuxSessionManager = {
        isAvailable: () => true,
        executeRawCommand: vi.fn().mockResolvedValue(""),
      } as any;
      provider = createProvider({ tmuxSessionManager });
      const runtime = provider["sessionRuntime"];
      const { messageHandler } = resolveProvider(provider);

      messageHandler({ type: "ready", cols: 100, rows: 30 });
      await flushAsyncStartup();

      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("native");
      messageHandler({ type: "paneCreate", paneId: "switch-pane" });
      await flushAsyncStartup();
      
      vi.spyOn(runtime, "getSession").mockImplementation((paneId) => {
        if (paneId === "default") return { tmuxSessionId: "tmux-s" } as any;
        if (paneId === "switch-pane") return { backend: "native", terminalKey: "switch-pane", instanceId: "switch-pane" } as any;
        return undefined;
      });
      expect(runtime.getSession("switch-pane")?.backend).toBe("native");

      vi.spyOn(runtime, "getActiveBackend").mockReturnValue("tmux");
      vi.spyOn(runtime, "createSession").mockResolvedValue(undefined);
      vi.spyOn(runtime, "getSession").mockImplementation((paneId) => {
        if (paneId === "default") return { tmuxSessionId: "tmux-s" } as any;
        if (paneId === "switch-pane") return { backend: "tmux" } as any;
        return undefined;
      });
      messageHandler({ type: "paneSwitchBackend", paneId: "switch-pane", backend: "tmux" });
      await flushAsyncStartup();

      expect(provider["paneStore"].getPane("switch-pane")).toBeDefined();
      expect(runtime.getSession("switch-pane")?.backend).toBe("tmux");
    });

    it("All backends support multi-pane", async () => {
      mockConfiguration({ autoStartOnOpen: false, enableHttpApi: false });
      provider = createProvider();

      expect(provider["isMultiPaneSupportedBackend"]()).toBe(true);
    });
  });
});
