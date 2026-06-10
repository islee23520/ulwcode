import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExtensionLifecycle } from "./ExtensionLifecycle";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { OutputChannelService } from "../services/OutputChannelService";
import { InstanceRegistry } from "../services/InstanceRegistry";
import { InstanceStore } from "../services/InstanceStore";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { TmuxSessionManager } from "../services/TmuxSessionManager";
import { ZellijSessionManager } from "../services/ZellijSessionManager";
import { TmuxPaneSyncService } from "../services/TmuxPaneSyncService";
import { ZellijPaneSyncService } from "../services/ZellijPaneSyncService";
import { SessionWindowHandoffService } from "../services/SessionWindowHandoffService";
import type * as vscodeTypes from "../test/mocks/vscode";

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

describe("ExtensionLifecycle", () => {
  let lifecycle: ExtensionLifecycle;
  let mockContext: any;

  const getRegisteredCommandHandler = <T extends Function>(
    commandId: string,
  ): T => {
    const commandCall = vi
      .mocked(vscode.commands.registerCommand)
      .mock.calls.find((call) => call[0] === commandId);

    expect(commandCall).toBeDefined();
    return commandCall?.[1] as T;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vscode.workspace.workspaceFolders = undefined;
    vi.mocked(vscode.window.registerWebviewViewProvider).mockImplementation(
      () => ({ dispose: vi.fn() }),
    );
    OutputChannelService.resetInstance();
    vi.spyOn(TmuxSessionManager.prototype, "isAvailable").mockResolvedValue(
      true,
    );
    lifecycle = new ExtensionLifecycle();
    mockContext = new vscode.ExtensionContext();
  });

  describe("activate", () => {
    it("should initialize terminal manager", async () => {
      await lifecycle.activate(mockContext);

      expect(mockContext.subscriptions.length).toBeGreaterThan(0);
    });

    it("should register webview provider", async () => {
      await lifecycle.activate(mockContext);

      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
        "ulw",
        expect.any(Object),
        expect.objectContaining({
          webviewOptions: { retainContextWhenHidden: true },
        }),
      );

      expect(vscode.window.registerWebviewPanelSerializer).toHaveBeenCalledWith(
        "ulw.terminalEditor",
        expect.any(Object),
      );
    });

    it("should skip tmux dashboard registration when tmux is unavailable", async () => {
      vi.spyOn(TmuxSessionManager.prototype, "isAvailable").mockResolvedValue(
        false,
      );

      await lifecycle.activate(mockContext);

      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
        "ulw",
        expect.any(Object),
        expect.objectContaining({
          webviewOptions: { retainContextWhenHidden: true },
        }),
      );
      expect(
        vscode.window.registerWebviewViewProvider,
      ).not.toHaveBeenCalledWith("ulw.tmuxSessions", expect.anything());
    });

    it("should log unavailable terminal backends and continue activation", async () => {
      vi.spyOn(TmuxSessionManager.prototype, "isAvailable").mockResolvedValue(
        false,
      );
      vi.spyOn(ZellijSessionManager.prototype, "isAvailable").mockResolvedValue(
        false,
      );

      await lifecycle.activate(mockContext);

      const outputChannel = vi.mocked(vscode.window.createOutputChannel).mock
        .results[0].value;
      expect(outputChannel.info).toHaveBeenCalledWith(
        expect.stringContaining("tmux not detected"),
      );
      expect(outputChannel.info).toHaveBeenCalledWith(
        expect.stringContaining("zellij not detected"),
      );
    });

    it("should swallow duplicate webview provider registration races", async () => {
      vi.mocked(vscode.window.registerWebviewViewProvider).mockImplementation(
        () => {
          throw new Error("provider already registered for ulw");
        },
      );

      await lifecycle.activate(mockContext);

      const outputChannel = vi.mocked(vscode.window.createOutputChannel).mock
        .results[0].value;
      expect(outputChannel.warn).toHaveBeenCalledWith(
        expect.stringContaining("provider already registered"),
      );
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it("should register commands", async () => {
      await lifecycle.activate(mockContext);

      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        "ulw.start",
        expect.any(Function),
      );
    });

    it("should consume selected project handoff into the active instance", async () => {
      const selectedWorkspaceUri = vscode.Uri.parse(
        "file:///workspace/selected",
      ).toString();
      const otherWorkspaceUri = vscode.Uri.parse(
        "file:///workspace/other",
      ).toString();
      const pendingHandoffsKey = "ulw.pendingSessionWindowHandoffs";
      let storedHandoffs: readonly unknown[] = [
        {
          id: "other-handoff",
          workspaceUri: otherWorkspaceUri,
          sessionId: "other-session",
          backend: "tmux",
          label: "Other Project",
          createdAt: Date.now(),
        },
        {
          id: "selected-handoff",
          workspaceUri: selectedWorkspaceUri,
          sessionId: "selected-session",
          backend: "zellij",
          label: "Selected Project",
          createdAt: Date.now() + 1,
        },
      ];
      vscode.workspace.workspaceFolders = [
        {
          uri: {
            fsPath: "/workspace/selected",
            toString: () => selectedWorkspaceUri,
          },
        },
      ] as typeof vscode.workspace.workspaceFolders;
      vi.mocked(mockContext.workspaceState.get).mockImplementation(
        (key: string, defaultValue: unknown) => {
          if (key === "ulw.instances.workspace") {
            return { instances: [], activeInstanceId: undefined };
          }
          return defaultValue;
        },
      );
      vi.mocked(mockContext.globalState.get).mockImplementation(
        (key: string, defaultValue: unknown) => {
          if (key === pendingHandoffsKey) {
            return storedHandoffs;
          }
          if (key === "ulw.hasAutoEnabledKeybindings") {
            return true;
          }
          return defaultValue;
        },
      );
      vi.mocked(mockContext.globalState.update).mockImplementation(
        async (key: string, value: unknown) => {
          if (key === pendingHandoffsKey && Array.isArray(value)) {
            storedHandoffs = value;
          }
        },
      );
      const consumeHandoffSpy = vi
        .spyOn(SessionWindowHandoffService.prototype, "consumeHandoff")
        .mockResolvedValue({
          id: "selected-handoff",
          workspaceUri: selectedWorkspaceUri,
          sessionId: "selected-session",
          backend: "zellij",
          label: "Selected Project",
          createdAt: Date.now(),
        });
      vi.spyOn(ZellijSessionManager.prototype, "isAvailable").mockResolvedValue(
        true,
      );

      await lifecycle.activate(mockContext);

      expect(consumeHandoffSpy).toHaveBeenCalledWith(selectedWorkspaceUri);

      const maybeStore = Reflect.get(lifecycle, "instanceStore");
      expect(maybeStore).toBeInstanceOf(InstanceStore);
      if (!(maybeStore instanceof InstanceStore)) {
        throw new Error("Expected ExtensionLifecycle to initialize InstanceStore");
      }
      const handoffRecord = maybeStore
        .getAll()
        .find((record) => record.runtime.zellijSessionId === "selected-session");

      expect(handoffRecord).toBeDefined();
      expect(handoffRecord!.config.workspaceUri).toBe(selectedWorkspaceUri);
      expect(handoffRecord!.config.label).toBe("Selected Project");
      expect(handoffRecord!.config.terminalBackend).toBe("zellij");
      expect(handoffRecord!.runtime.zellijSessionId).toBe("selected-session");
      expect(handoffRecord!.runtime.tmuxSessionId).toBeUndefined();
      expect(maybeStore.getActive().config.id).toBe(handoffRecord!.config.id);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "ulw.focus",
      );
      expect(
        SessionWindowHandoffService.prototype.consumeHandoff,
      ).toHaveBeenCalledWith(selectedWorkspaceUri);
    });

    it("should skip duplicate activation attempts", async () => {
      await lifecycle.activate(mockContext);
      const registrationCount = vi.mocked(vscode.window.registerWebviewViewProvider)
        .mock.calls.length;

      await lifecycle.activate(mockContext);

      const outputChannel = vi.mocked(vscode.window.createOutputChannel).mock
        .results[0].value;
      expect(outputChannel.warn).toHaveBeenCalledWith(
        expect.stringContaining("activate() called while already active"),
      );
      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledTimes(
        registrationCount,
      );
    });

    it("should register zellij as available when detected", async () => {
      vi.spyOn(ZellijSessionManager.prototype, "isAvailable").mockResolvedValue(
        true,
      );

      await lifecycle.activate(mockContext);

      expect(Reflect.get(lifecycle, "zellijSessionManager")).toBeInstanceOf(
        ZellijSessionManager,
      );
    });

    it("should initialize pane sync services and pass them to TerminalProvider", async () => {
      await lifecycle.activate(mockContext);

      expect(Reflect.get(lifecycle, "tmuxPaneSyncService")).toBeInstanceOf(
        TmuxPaneSyncService,
      );
      expect(Reflect.get(lifecycle, "zellijPaneSyncService")).toBeInstanceOf(
        ZellijPaneSyncService,
      );
    });

    it("should initialize core services without creating a status bar item", async () => {
      await lifecycle.activate(mockContext);

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith(
        "ULW",
        { log: true },
      );
    });

    it("should initialize ContextManager with OutputChannelService", async () => {
      await lifecycle.activate(mockContext);

      const outputChannel = vi.mocked(vscode.window.createOutputChannel).mock
        .results[0].value;
      expect(outputChannel.info).toHaveBeenCalledWith(
        expect.stringContaining("ContextManager initialized"),
      );
    });

    it("should register code actions provider for all languages", async () => {
      await lifecycle.activate(mockContext);

      expect(vscode.languages.registerCodeActionsProvider).toHaveBeenCalledWith(
        "*",
        expect.any(Object),
        expect.objectContaining({
          providedCodeActionKinds: expect.any(Array),
        }),
      );
    });

    it("should route Explain and Fix diagnostics through the lifecycle prompt callback", async () => {
      const sendPrompt = vi.fn().mockResolvedValue(undefined);
      Reflect.set(lifecycle, "sendPromptToOpenCode", sendPrompt);

      await lifecycle.activate(mockContext);

      const explainAndFix = getRegisteredCommandHandler<
        (args: { diagnostic: unknown; documentUri: string }) => Promise<void>
      >("ulw.explainAndFix");

      await explainAndFix({
        diagnostic: {
          message: "Broken",
          severity: vscode.DiagnosticSeverity.Error,
          range: vscode.Range(0, 0, 0, 6),
          source: "ts",
        },
        documentUri: "file:///workspace/file.ts",
      });

      expect(sendPrompt).toHaveBeenCalled();
    });

    it("should hydrate the instance registry and wire terminal close cleanup", async () => {
      const hydrateSpy = vi.spyOn(InstanceRegistry.prototype, "hydrate");
      const cleanupSpy = vi.spyOn(OutputCaptureManager.prototype, "cleanup");

      await lifecycle.activate(mockContext);

      expect(hydrateSpy).toHaveBeenCalledTimes(1);
      expect(hydrateSpy.mock.calls[0]?.[0]).toBeInstanceOf(InstanceStore);

      const closeListener = vi.mocked(vscode.window.onDidCloseTerminal).mock
        .calls[0]?.[0] as (terminal: unknown) => void;
      const terminal = { name: "closed-terminal" };

      closeListener(terminal);

      expect(cleanupSpy).toHaveBeenCalledWith(terminal);
    });

    it("should log native shell fallback when tmux is unavailable", async () => {
      vi.spyOn(TmuxSessionManager.prototype, "isAvailable").mockResolvedValue(
        false,
      );

      await lifecycle.activate(mockContext);

      const outputChannel = vi.mocked(vscode.window.createOutputChannel).mock
        .results[0].value;
      expect(outputChannel.info).toHaveBeenCalledWith(
        expect.stringContaining("tmux not detected"),
      );
    });

    it("should handle activation errors", async () => {
      vi.mocked(vscode.window.registerWebviewViewProvider).mockImplementation(
        () => {
          throw new Error("Registration failed");
        },
      );

      await lifecycle.activate(mockContext);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("Failed to activate"),
      );
    });

    it("should stringify non-error activation failures", async () => {
      vi.mocked(vscode.window.registerWebviewViewProvider).mockImplementation(
        () => {
          throw "Registration failed as string";
        },
      );

      await lifecycle.activate(mockContext);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("Registration failed as string"),
      );
    });
  });

  describe("deactivate", () => {
    it("should safely no-op when services were never initialized", async () => {
      await expect(lifecycle.deactivate()).resolves.toBeUndefined();
    });

    it("should dispose providers", async () => {
      await lifecycle.activate(mockContext);
      await lifecycle.deactivate();

      expect(mockContext.subscriptions).toBeDefined();
    });

    it("should dispose wave services", async () => {
      await lifecycle.activate(mockContext);
      await lifecycle.deactivate();

      const outputChannel = vi.mocked(vscode.window.createOutputChannel).mock
        .results[0].value;

      expect(outputChannel.dispose).toHaveBeenCalled();
    });

    it("should dispose all initialized collaborators without showing shutdown prompts", async () => {
      const logger = { info: vi.fn(), dispose: vi.fn() };
      const tuiProvider = { dispose: vi.fn() };
      const terminalManager = { dispose: vi.fn() };
      const contextManager = { dispose: vi.fn() };
      const instanceDiscoveryService = { dispose: vi.fn() };
      const instanceRegistry = { dispose: vi.fn() };
      const tuiProviderRegistration = { dispose: vi.fn() };
      const tmuxPaneSyncService = { dispose: vi.fn() };
      const zellijPaneSyncService = { dispose: vi.fn() };
      const tmuxSessionManager = {
        discoverSessions: vi.fn().mockResolvedValue([{ id: "active-tmux" }]),
        killSession: vi.fn(),
      };

      Reflect.set(lifecycle, "outputChannelService", logger);
      Reflect.set(lifecycle, "tuiProvider", tuiProvider);
      Reflect.set(lifecycle, "terminalManager", terminalManager);
      Reflect.set(lifecycle, "contextManager", contextManager);
      Reflect.set(
        lifecycle,
        "instanceDiscoveryService",
        instanceDiscoveryService,
      );
      Reflect.set(lifecycle, "instanceRegistry", instanceRegistry);
      Reflect.set(lifecycle, "instanceStore", new InstanceStore());
      Reflect.set(lifecycle, "tuiProviderRegistration", tuiProviderRegistration);
      Reflect.set(lifecycle, "tmuxPaneSyncService", tmuxPaneSyncService);
      Reflect.set(lifecycle, "zellijPaneSyncService", zellijPaneSyncService);
      Reflect.set(lifecycle, "tmuxSessionManager", tmuxSessionManager);

      await lifecycle.deactivate();

      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(tuiProvider.dispose).toHaveBeenCalledTimes(1);
      expect(terminalManager.dispose).toHaveBeenCalledTimes(1);
      expect(logger.dispose).toHaveBeenCalledTimes(1);
      expect(contextManager.dispose).toHaveBeenCalledTimes(1);
      expect(instanceDiscoveryService.dispose).toHaveBeenCalledTimes(1);
      expect(instanceRegistry.dispose).toHaveBeenCalledTimes(1);
      expect(tuiProviderRegistration.dispose).toHaveBeenCalledTimes(1);
      expect(tmuxPaneSyncService.dispose).toHaveBeenCalledTimes(1);
      expect(zellijPaneSyncService.dispose).toHaveBeenCalledTimes(1);
      expect(Reflect.get(lifecycle, "tuiProvider")).toBeUndefined();
      expect(Reflect.get(lifecycle, "terminalManager")).toBeUndefined();
      expect(Reflect.get(lifecycle, "outputChannelService")).toBeUndefined();
      expect(Reflect.get(lifecycle, "contextManager")).toBeUndefined();
      expect(
        Reflect.get(lifecycle, "instanceDiscoveryService"),
      ).toBeUndefined();
      expect(Reflect.get(lifecycle, "instanceRegistry")).toBeUndefined();
      expect(Reflect.get(lifecycle, "instanceStore")).toBeUndefined();
      expect(Reflect.get(lifecycle, "tuiProviderRegistration")).toBeUndefined();
      expect(Reflect.get(lifecycle, "tmuxPaneSyncService")).toBeUndefined();
      expect(Reflect.get(lifecycle, "zellijPaneSyncService")).toBeUndefined();
      expect(logger.info).toHaveBeenLastCalledWith("ULW deactivated");
    });
  });

  describe("private helpers", () => {
    it("should expose live command dependencies and helper closures", async () => {
      const provider = { sendPrompt: vi.fn().mockResolvedValue(undefined) };
      const tmuxSessionManager = { kind: "tmux" };
      const zellijSessionManager = { kind: "zellij" };
      const focusTmuxManager = {
        getActiveFocus: vi.fn().mockResolvedValue({ paneId: "%1" }),
      };
      const terminalManager = { kind: "terminal" };
      const contextSharingService = { kind: "share" };
      const contextManager = { kind: "context" };
      const instanceStore = new InstanceStore();
      const instanceController = { kind: "controller" };
      const instanceQuickPick = { kind: "picker" };
      const outputChannelService = { kind: "logger" };
      const getActiveTerminalIdSpy = vi
        .spyOn(lifecycle as any, "getActiveTerminalId")
        .mockReturnValue("terminal-42");
      const sendTerminalCwdSpy = vi
        .spyOn(lifecycle as any, "sendTerminalCwd")
        .mockImplementation(() => undefined);
      const resolveActiveTmuxSessionIdSpy = vi
        .spyOn(lifecycle as any, "resolveActiveTmuxSessionId")
        .mockReturnValue("tmux-42");

      Reflect.set(lifecycle, "tuiProvider", provider);
      Reflect.set(lifecycle, "tmuxSessionManager", tmuxSessionManager);
      Reflect.set(lifecycle, "zellijSessionManager", zellijSessionManager);
      Reflect.set(lifecycle, "terminalManager", terminalManager);
      Reflect.set(lifecycle, "contextSharingService", contextSharingService);
      Reflect.set(lifecycle, "contextManager", contextManager);
      Reflect.set(lifecycle, "instanceStore", instanceStore);
      Reflect.set(lifecycle, "instanceController", instanceController);
      Reflect.set(lifecycle, "instanceQuickPick", instanceQuickPick);
      Reflect.set(lifecycle, "outputChannelService", outputChannelService);

      const deps = (lifecycle as any).getCommandDependencies();

      expect(deps.provider).toBe(provider);
      expect(deps.tmuxManager).toBe(tmuxSessionManager);
      expect(deps.zellijManager).toBe(zellijSessionManager);
      expect(deps.terminalManager).toBe(terminalManager);
      expect(deps.contextSharingService).toBe(contextSharingService);
      expect(deps.contextManager).toBe(contextManager);
      expect(deps.instanceStore).toBe(instanceStore);
      expect(deps.instanceController).toBe(instanceController);
      expect(deps.instanceQuickPick).toBe(instanceQuickPick);
      expect(deps.outputChannel).toBe(outputChannelService);
      expect(deps.getActiveTerminalId()).toBe("terminal-42");
      deps.sendTerminalCwd();
      await deps.sendPrompt("hello");
      expect(deps.resolveActiveTmuxSessionId()).toBe("tmux-42");
      Reflect.set(lifecycle, "tmuxSessionManager", focusTmuxManager);
      await expect(deps.resolveActiveTmuxFocus()).resolves.toEqual({
        paneId: "%1",
      });
      Reflect.set(lifecycle, "tmuxSessionManager", undefined);
      await expect(deps.resolveActiveTmuxFocus()).resolves.toBeUndefined();
      Reflect.set(lifecycle, "tuiProvider", undefined);
      await expect(deps.sendPrompt("without provider")).resolves.toBeUndefined();
      vscode.workspace.workspaceFolders = [
        { uri: { fsPath: "/repo" } },
      ] as never;
      expect(deps.resolveWorkspacePath()).toBe("/repo");
      vscode.workspace.workspaceFolders = undefined;
      expect(deps.resolveWorkspacePath()).toBeUndefined();

      expect(getActiveTerminalIdSpy).toHaveBeenCalledTimes(1);
      expect(sendTerminalCwdSpy).toHaveBeenCalledTimes(1);
      expect(provider.sendPrompt).toHaveBeenCalledWith("hello");
      expect(resolveActiveTmuxSessionIdSpy).toHaveBeenCalledTimes(1);
      expect(focusTmuxManager.getActiveFocus).toHaveBeenCalledTimes(1);
    });

    it("should resolve the active terminal id from runtime terminal key", () => {
      const instanceStore = {
        getActive: vi.fn(() => ({
          config: { id: "instance-1" },
          runtime: { terminalKey: "terminal-1", tmuxSessionId: "tmux-1" },
        })),
      };

      Reflect.set(lifecycle, "instanceStore", instanceStore);

      expect((lifecycle as any).getActiveTerminalId()).toBe("terminal-1");
    });

    it("should fall back to config id when runtime terminal key is missing", () => {
      const warn = vi.fn();
      Reflect.set(lifecycle, "outputChannelService", { warn });
      Reflect.set(lifecycle, "instanceStore", {
        getActive: vi.fn(() => ({ config: { id: "instance-2" }, runtime: {} })),
      });

      expect((lifecycle as any).getActiveTerminalId()).toBe("instance-2");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("NO terminalKey"),
      );
    });

    it("should fall back to the static terminal id when no instance is active", () => {
      const warn = vi.fn();
      Reflect.set(lifecycle, "outputChannelService", { warn });
      Reflect.set(lifecycle, "instanceStore", {
        getActive: vi.fn(() => undefined),
      });

      expect((lifecycle as any).getActiveTerminalId()).toBe("opencode-main");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("NO active instance"),
      );
    });

    it("should handle active terminal id resolution errors", () => {
      const error = vi.fn();
      Reflect.set(lifecycle, "outputChannelService", { error });
      Reflect.set(lifecycle, "instanceStore", {
        getActive: vi.fn(() => {
          throw new Error("boom");
        }),
      });

      expect((lifecycle as any).getActiveTerminalId()).toBe("opencode-main");
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("ERROR: boom"),
      );
    });

    it("should stringify non-error active terminal id resolution failures", () => {
      const error = vi.fn();
      Reflect.set(lifecycle, "outputChannelService", { error });
      Reflect.set(lifecycle, "instanceStore", {
        getActive: vi.fn(() => {
          throw "string boom";
        }),
      });

      expect((lifecycle as any).getActiveTerminalId()).toBe("opencode-main");
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("ERROR: string boom"),
      );
    });

    it("should return undefined when resolving the active tmux session id throws", () => {
      Reflect.set(lifecycle, "instanceStore", {
        getActive: vi.fn(() => {
          throw new Error("broken store");
        }),
      });

      expect((lifecycle as any).resolveActiveTmuxSessionId()).toBeUndefined();
    });

    it("should resolve active tmux session ids from the active instance", () => {
      Reflect.set(lifecycle, "instanceStore", {
        getActive: vi.fn(() => ({ runtime: { tmuxSessionId: "tmux-active" } })),
      });

      expect((lifecycle as any).resolveActiveTmuxSessionId()).toBe(
        "tmux-active",
      );

      Reflect.set(lifecycle, "instanceStore", {
        getActive: vi.fn(() => undefined),
      });

      expect((lifecycle as any).resolveActiveTmuxSessionId()).toBeUndefined();
    });

    it("should return false when no discovery service is available", async () => {
      await expect(
        (lifecycle as any).trySendPromptViaDiscoveredInstance("hello"),
      ).resolves.toBe(false);
    });

    it("should return false when discovery finds no instances", async () => {
      Reflect.set(lifecycle, "instanceDiscoveryService", {
        discoverInstances: vi.fn().mockResolvedValue([]),
      });

      await expect(
        (lifecycle as any).trySendPromptViaDiscoveredInstance("hello"),
      ).resolves.toBe(false);
    });

    it("should send prompts via discovered instances when available", async () => {
      const info = vi.fn();
      const appendPromptSpy = vi
        .spyOn(OpenCodeApiClient.prototype, "appendPrompt")
        .mockResolvedValue(undefined);
      Reflect.set(lifecycle, "outputChannelService", { info });
      Reflect.set(lifecycle, "instanceDiscoveryService", {
        discoverInstances: vi.fn().mockResolvedValue([{ port: 4317 }]),
      });

      await expect(
        (lifecycle as any).trySendPromptViaDiscoveredInstance("hello"),
      ).resolves.toBe(true);

      expect(appendPromptSpy).toHaveBeenCalledWith("hello");
      expect(info).toHaveBeenCalledWith(expect.stringContaining("port 4317"));
    });

    it("should warn and return false when discovered instance forwarding fails", async () => {
      const warn = vi.fn();
      vi.spyOn(OpenCodeApiClient.prototype, "appendPrompt").mockRejectedValue(
        new Error("offline"),
      );
      Reflect.set(lifecycle, "outputChannelService", { warn });
      Reflect.set(lifecycle, "instanceDiscoveryService", {
        discoverInstances: vi.fn().mockResolvedValue([{ port: 9999 }]),
      });

      await expect(
        (lifecycle as any).trySendPromptViaDiscoveredInstance("hello"),
      ).resolves.toBe(false);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to send prompt via discovered instance",
        ),
      );
    });

    it("should stringify non-error discovered instance forwarding failures", async () => {
      const warn = vi.fn();
      vi.spyOn(OpenCodeApiClient.prototype, "appendPrompt").mockRejectedValue(
        "offline string",
      );
      Reflect.set(lifecycle, "outputChannelService", { warn });
      Reflect.set(lifecycle, "instanceDiscoveryService", {
        discoverInstances: vi.fn().mockResolvedValue([{ port: 9998 }]),
      });

      await expect(
        (lifecycle as any).trySendPromptViaDiscoveredInstance("hello"),
      ).resolves.toBe(false);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("offline string"),
      );
    });
  });

  describe("prompt routing", () => {
    it("should throw if sendPromptToOpenCode is called before initialization", async () => {
      await expect(
        (lifecycle as any).sendPromptToOpenCode("hello"),
      ).rejects.toThrow("OpenCode provider is not initialized");
    });

    it("should start OpenCode and send the prompt through HTTP when needed", async () => {
      vi.useFakeTimers();

      const appendPrompt = vi.fn().mockResolvedValue(undefined);
      const focus = vi.fn();
      const startOpenCode = vi.fn().mockResolvedValue(undefined);
      const startAtConfiguredLocation = vi.fn().mockResolvedValue(undefined);
      const provider = {
        startOpenCode,
        startAtConfiguredLocation,
        getApiClient: vi.fn(() => ({ appendPrompt })),
        isHttpAvailable: vi.fn(() => true),
        focus,
      };
      const terminalManager = {
        getTerminal: vi.fn(() => undefined),
        writeToTerminal: vi.fn(),
      };
      Reflect.set(lifecycle, "tuiProvider", provider);
      Reflect.set(lifecycle, "terminalManager", terminalManager);
      Reflect.set(lifecycle, "instanceDiscoveryService", {
        discoverInstances: vi.fn().mockResolvedValue([]),
      });

      const sendPromise = (lifecycle as any).sendPromptToOpenCode("ship it");
      await sendPromise;
      await vi.runAllTimersAsync();

      expect(startAtConfiguredLocation).toHaveBeenCalledTimes(1);
      expect(startOpenCode).not.toHaveBeenCalled();
      expect(appendPrompt).toHaveBeenCalledWith("ship it");
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "ulw.focus",
      );
      expect(focus).toHaveBeenCalledTimes(1);
      expect(terminalManager.writeToTerminal).not.toHaveBeenCalled();
    });

    it("should prefer discovered instances before starting OpenCode", async () => {
      const appendPromptSpy = vi
        .spyOn(OpenCodeApiClient.prototype, "appendPrompt")
        .mockResolvedValue(undefined);
      const provider = {
        startOpenCode: vi.fn().mockResolvedValue(undefined),
        startAtConfiguredLocation: vi.fn().mockResolvedValue(undefined),
        getApiClient: vi.fn(),
        isHttpAvailable: vi.fn(() => false),
      };
      const terminalManager = {
        getTerminal: vi.fn(() => undefined),
        writeToTerminal: vi.fn(),
      };

      Reflect.set(lifecycle, "tuiProvider", provider);
      Reflect.set(lifecycle, "terminalManager", terminalManager);
      Reflect.set(lifecycle, "instanceDiscoveryService", {
        discoverInstances: vi.fn().mockResolvedValue([{ port: 7777 }]),
      });

      await (lifecycle as any).sendPromptToOpenCode("hello");

      expect(appendPromptSpy).toHaveBeenCalledWith("hello");
      expect(provider.startOpenCode).not.toHaveBeenCalled();
      expect(provider.startAtConfiguredLocation).not.toHaveBeenCalled();
      expect(provider.getApiClient).not.toHaveBeenCalled();
    });

    it("should fall back to terminal input when the HTTP API append fails", async () => {
      const warn = vi.fn();
      const provider = {
        getApiClient: vi.fn(() => ({
          appendPrompt: vi.fn().mockRejectedValue(new Error("http down")),
        })),
        isHttpAvailable: vi.fn(() => true),
      };
      const terminalManager = {
        getTerminal: vi.fn(() => ({ id: "terminal" })),
        writeToTerminal: vi.fn(),
      };

      Reflect.set(lifecycle, "tuiProvider", provider);
      Reflect.set(lifecycle, "terminalManager", terminalManager);
      Reflect.set(lifecycle, "outputChannelService", { warn });

      await (lifecycle as any).sendPromptToOpenCode("hello");

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("falling back to terminal input"),
      );
      expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
        "opencode-main",
        "hello\n",
      );
    });

    it("should stringify non-error HTTP append failures and skip non-callable focus", async () => {
      vi.useFakeTimers();

      const warn = vi.fn();
      const provider = {
        getApiClient: vi.fn(() => ({
          appendPrompt: vi.fn().mockRejectedValue("http string down"),
        })),
        isHttpAvailable: vi.fn(() => true),
        focus: "not callable",
      };
      const terminalManager = {
        getTerminal: vi.fn(() => ({ id: "terminal" })),
        writeToTerminal: vi.fn(),
      };

      Reflect.set(lifecycle, "tuiProvider", provider);
      Reflect.set(lifecycle, "terminalManager", terminalManager);
      Reflect.set(lifecycle, "outputChannelService", { warn });

      await (lifecycle as any).sendPromptToOpenCode("hello");
      await vi.runAllTimersAsync();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("http string down"),
      );
      expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
        "opencode-main",
        "hello\n",
      );
    });

    it("should write directly to the terminal when HTTP is unavailable", async () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn(() => false),
        inspect: vi.fn(() => undefined),
        update: vi.fn(),
      } as never);

      const provider = {
        getApiClient: vi.fn(() => undefined),
        isHttpAvailable: vi.fn(() => false),
        focus: vi.fn(),
      };
      const terminalManager = {
        getTerminal: vi.fn(() => ({ id: "terminal" })),
        writeToTerminal: vi.fn(),
      };

      Reflect.set(lifecycle, "tuiProvider", provider);
      Reflect.set(lifecycle, "terminalManager", terminalManager);

      await (lifecycle as any).sendPromptToOpenCode("fallback");

      expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
        "opencode-main",
        "fallback\n",
      );
      expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
        "ulw.focus",
      );
    });
  });

  describe("terminal cwd forwarding", () => {
    it("should warn when there is no active terminal", () => {
      vscode.window.activeTerminal = undefined;

      (lifecycle as any).sendTerminalCwd();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        "No active terminal",
      );
    });

    it("should warn when shell integration does not expose a cwd", () => {
      vscode.window.activeTerminal = { shellIntegration: {} };

      (lifecycle as any).sendTerminalCwd();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining(
          "Could not determine terminal working directory",
        ),
      );
    });

    it("should send a relative cwd reference when a workspace is open", async () => {
      vi.useFakeTimers();

      const focus = vi.fn();
      const terminalManager = { writeToTerminal: vi.fn() };
      vscode.window.activeTerminal = {
        shellIntegration: { cwd: { fsPath: "/repo/packages/core" } },
      };
      vscode.workspace.workspaceFolders = [
        { uri: { fsPath: "/repo" } },
      ] as never;
      vi.mocked(vscode.workspace.asRelativePath).mockReturnValue(
        "packages/core",
      );
      Reflect.set(lifecycle, "terminalManager", terminalManager);
      Reflect.set(lifecycle, "tuiProvider", { focus });

      (lifecycle as any).sendTerminalCwd();
      await vi.runAllTimersAsync();

      expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
        "opencode-main",
        "@packages/core ",
      );
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "ulw.focus",
      );
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("should send an absolute cwd reference when no workspace is open", () => {
      const terminalManager = { writeToTerminal: vi.fn() };
      vscode.window.activeTerminal = {
        shellIntegration: { cwd: { fsPath: "/tmp/project" } },
      };
      vscode.workspace.workspaceFolders = undefined;
      Reflect.set(lifecycle, "terminalManager", terminalManager);

      (lifecycle as any).sendTerminalCwd();

      expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
        "opencode-main",
        "@/tmp/project ",
      );
    });

    it("should not focus a provider without a callable focus method", async () => {
      vi.useFakeTimers();

      const terminalManager = { writeToTerminal: vi.fn() };
      vscode.window.activeTerminal = {
        shellIntegration: { cwd: { fsPath: "/tmp/project" } },
      };
      vscode.workspace.workspaceFolders = undefined;
      Reflect.set(lifecycle, "terminalManager", terminalManager);
      Reflect.set(lifecycle, "tuiProvider", {});

      (lifecycle as any).sendTerminalCwd();
      await vi.runAllTimersAsync();

      expect(terminalManager.writeToTerminal).toHaveBeenCalledWith(
        "opencode-main",
        "@/tmp/project ",
      );
    });
  });

  describe("tmux shutdown prompt", () => {
    it("should return early when there are no tmux sessions to kill", async () => {
      const tmuxManager = {
        discoverSessions: vi.fn().mockResolvedValue([]),
        killSession: vi.fn(),
      };
      Reflect.set(lifecycle, "tmuxSessionManager", tmuxManager);

      await (lifecycle as any).promptKillTmuxSessions();

      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(tmuxManager.killSession).not.toHaveBeenCalled();
    });

    it("should keep tmux sessions running when the user declines shutdown", async () => {
      const tmuxManager = {
        discoverSessions: vi.fn().mockResolvedValue([{ id: "session-1" }]),
        killSession: vi.fn(),
      };
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
        "Keep Running" as never,
      );
      Reflect.set(lifecycle, "tmuxSessionManager", tmuxManager);

      await (lifecycle as any).promptKillTmuxSessions();

      expect(tmuxManager.killSession).not.toHaveBeenCalled();
    });

    it("should route tmux session shutdown through provider and manager safely", async () => {
      const tmuxManager = {
        discoverSessions: vi
          .fn()
          .mockResolvedValue([
            { id: "instance-session" },
            { id: "external-session" },
          ]),
        killSession: vi.fn().mockResolvedValue(undefined),
      };
      const killTmuxSession = vi.fn().mockResolvedValue(undefined);
      const instanceStore = new InstanceStore();
      instanceStore.upsert({
        config: { id: "instance-1", label: "OpenCode" },
        runtime: { tmuxSessionId: "instance-session" },
        state: "connected",
      });
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
        "Kill Sessions" as never,
      );
      Reflect.set(lifecycle, "tmuxSessionManager", tmuxManager);
      Reflect.set(lifecycle, "instanceStore", instanceStore);
      Reflect.set(lifecycle, "tuiProvider", { killTmuxSession });

      await (lifecycle as any).promptKillTmuxSessions();

      expect(killTmuxSession).toHaveBeenCalledWith("instance-session");
      expect(tmuxManager.killSession).toHaveBeenCalledWith("external-session");
    });

    it("should kill sessions through the manager when no instance store is available", async () => {
      const tmuxManager = {
        discoverSessions: vi.fn().mockResolvedValue([{ id: "external-session" }]),
        killSession: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
        "Kill Sessions" as never,
      );
      Reflect.set(lifecycle, "tmuxSessionManager", tmuxManager);
      Reflect.set(lifecycle, "instanceStore", undefined);

      await (lifecycle as any).promptKillTmuxSessions();

      expect(tmuxManager.killSession).toHaveBeenCalledWith("external-session");
    });

    it("should safely resolve instance-backed shutdown without a provider", async () => {
      const tmuxManager = {
        discoverSessions: vi.fn().mockResolvedValue([{ id: "instance-session" }]),
        killSession: vi.fn().mockResolvedValue(undefined),
      };
      const instanceStore = new InstanceStore();
      instanceStore.upsert({
        config: { id: "instance-1", label: "OpenCode" },
        runtime: { tmuxSessionId: "instance-session" },
        state: "connected",
      });
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
        "Kill Sessions" as never,
      );
      Reflect.set(lifecycle, "tmuxSessionManager", tmuxManager);
      Reflect.set(lifecycle, "instanceStore", instanceStore);
      Reflect.set(lifecycle, "tuiProvider", undefined);

      await (lifecycle as any).promptKillTmuxSessions();

      expect(tmuxManager.killSession).not.toHaveBeenCalled();
    });
  });

  describe("commands", () => {
    beforeEach(async () => {
      await lifecycle.activate(mockContext);
    });

    it("should register start command", () => {
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const startCall = calls.find((call) => call[0] === "ulw.start");

      expect(startCall).toBeDefined();
    });

    it("should register sendToTerminal command", () => {
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const sendCall = calls.find(
        (call) => call[0] === "ulw.sendToTerminal",
      );

      expect(sendCall).toBeDefined();
    });

    it("should register sendAtMention command", () => {
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const mentionCall = calls.find(
        (call) => call[0] === "ulw.sendAtMention",
      );

      expect(mentionCall).toBeDefined();
    });

    it("should register sendAllOpenFiles command", () => {
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const allFilesCall = calls.find(
        (call) => call[0] === "ulw.sendAllOpenFiles",
      );

      expect(allFilesCall).toBeDefined();
    });

    it("should register sendFileToTerminal command", () => {
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const fileCall = calls.find(
        (call) => call[0] === "ulw.sendFileToTerminal",
      );

      expect(fileCall).toBeDefined();
    });

    it("should register and execute tmux management commands", async () => {
      const createTmuxSession = vi.fn().mockResolvedValue(undefined);
      const switchToNativeShell = vi.fn().mockResolvedValue(undefined);

      Reflect.set(lifecycle, "tuiProvider", {
        createTmuxSession,
        switchToNativeShell,
      });

      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const createCall = calls.find(
        (call) => call[0] === "ulw.createTmuxSession",
      );
      const nativeCall = calls.find(
        (call) => call[0] === "ulw.switchNativeShell",
      );

      expect(createCall).toBeDefined();
      expect(nativeCall).toBeDefined();

      const createHandler = createCall?.[1] as () => Promise<void>;
      const nativeHandler = nativeCall?.[1] as () => Promise<void>;

      await createHandler();
      await nativeHandler();

      expect(createTmuxSession).toHaveBeenCalledTimes(1);
      expect(switchToNativeShell).toHaveBeenCalledTimes(1);
    });

    describe("ulw.spawnForWorkspace", () => {
      const getSpawnForWorkspaceHandler = () => {
        (lifecycle as any).registerCommands(mockContext);
        const commandCall = vi
          .mocked(vscode.commands.registerCommand)
          .mock.calls.find((call) => call[0] === "ulw.spawnForWorkspace");

        expect(commandCall).toBeDefined();
        return commandCall?.[1] as (uri?: {
          toString(): string;
        }) => Promise<void>;
      };

      it("should focus reusable existing workspace instance instead of creating duplicate", async () => {
        const workspaceUri = "file:///workspace/reused";
        const instanceStore = new InstanceStore();
        instanceStore.upsert({
          config: {
            id: "existing-workspace-instance",
            workspaceUri,
            label: "Existing Workspace",
          },
          runtime: {},
          state: "connected",
        });

        const spawnSpy = vi.fn().mockResolvedValue(undefined);
        (lifecycle as any).instanceStore = instanceStore;
        (lifecycle as any).instanceController = { spawn: spawnSpy };

        const spawnForWorkspace = getSpawnForWorkspaceHandler();
        await spawnForWorkspace({ toString: () => workspaceUri });

        expect(spawnSpy).not.toHaveBeenCalled();
        expect(instanceStore.getAll()).toHaveLength(1);
        expect(instanceStore.getActive().config.id).toBe(
          "existing-workspace-instance",
        );
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
          "ulw.focus",
        );
      });

      it("should spawn matching disconnected workspace instance instead of focus-only no-op", async () => {
        const workspaceUri = "file:///workspace/disconnected";
        const instanceStore = new InstanceStore();
        instanceStore.upsert({
          config: {
            id: "disconnected-workspace-instance",
            workspaceUri,
            label: "Disconnected Workspace",
          },
          runtime: {},
          state: "disconnected",
        });

        const spawnSpy = vi.fn().mockResolvedValue(undefined);
        (lifecycle as any).instanceStore = instanceStore;
        (lifecycle as any).instanceController = { spawn: spawnSpy };

        const spawnForWorkspace = getSpawnForWorkspaceHandler();
        await spawnForWorkspace({ toString: () => workspaceUri });

        expect(spawnSpy).toHaveBeenCalledTimes(1);
        expect(spawnSpy).toHaveBeenCalledWith(
          "disconnected-workspace-instance",
        );
        expect(instanceStore.getAll()).toHaveLength(1);
        expect(instanceStore.getActive().config.id).toBe(
          "disconnected-workspace-instance",
        );
      });

      it("should persist workspace metadata for new workspace instances before spawn", async () => {
        const instanceStore = new InstanceStore();
        const spawnSpy = vi.fn().mockResolvedValue(undefined);
        (lifecycle as any).instanceStore = instanceStore;
        (lifecycle as any).instanceController = { spawn: spawnSpy };

        const workspaceUri = "file:///workspace/new";
        const spawnForWorkspace = getSpawnForWorkspaceHandler();
        await spawnForWorkspace({ toString: () => workspaceUri });

        expect(spawnSpy).toHaveBeenCalledTimes(1);
        const spawnedId = spawnSpy.mock.calls[0]?.[0] as string;
        const createdRecord = instanceStore.get(spawnedId);

        expect(createdRecord).toBeDefined();
        expect(createdRecord?.config.workspaceUri).toBe(workspaceUri);
        expect(createdRecord?.config.label).toBe("OpenCode (Workspace)");
      });
    });
  });

  describe("sendKeybindingsToShell auto-enable (ensureSendKeybindingsToShellDefault)", () => {
    it("should respect explicit user config (globalValue) and skip auto-enable", async () => {
      const inspectMock = vi.fn(() => ({ globalValue: false }));
      const updateMock = vi.fn();
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation((section) => {
        if (section === "ulw") {
          return {
            inspect: inspectMock,
            update: updateMock,
            get: vi.fn(),
          } as any;
        }
        return { get: vi.fn(), update: vi.fn(), inspect: vi.fn() } as any;
      });

      await lifecycle.activate(mockContext);

      expect(inspectMock).toHaveBeenCalledWith("sendKeybindingsToShell");
      expect(updateMock).not.toHaveBeenCalledWith(
        "sendKeybindingsToShell",
        true,
        vscode.ConfigurationTarget.Global,
      );
    });

    it("should respect explicit user config (workspaceValue) and skip auto-enable", async () => {
      const inspectMock = vi.fn(() => ({ workspaceValue: true }));
      const updateMock = vi.fn();
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation((section) => {
        if (section === "ulw") {
          return {
            inspect: inspectMock,
            update: updateMock,
            get: vi.fn(),
          } as any;
        }
        return { get: vi.fn(), update: vi.fn(), inspect: vi.fn() } as any;
      });

      await lifecycle.activate(mockContext);

      expect(inspectMock).toHaveBeenCalledWith("sendKeybindingsToShell");
      expect(updateMock).not.toHaveBeenCalledWith(
        "sendKeybindingsToShell",
        expect.anything(),
        expect.anything(),
      );
    });

    it("should respect explicit user config (workspaceFolderValue) and skip auto-enable", async () => {
      const inspectMock = vi.fn(() => ({ workspaceFolderValue: false }));
      const updateMock = vi.fn();
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation((section) => {
        if (section === "ulw") {
          return {
            inspect: inspectMock,
            update: updateMock,
            get: vi.fn(),
          } as any;
        }
        return { get: vi.fn(), update: vi.fn(), inspect: vi.fn() } as any;
      });

      await lifecycle.activate(mockContext);

      expect(inspectMock).toHaveBeenCalledWith("sendKeybindingsToShell");
      expect(updateMock).not.toHaveBeenCalledWith(
        "sendKeybindingsToShell",
        true,
        vscode.ConfigurationTarget.Global,
      );
    });

    it("should skip auto-enable when alreadyAutoEnabled flag is true in globalState", async () => {
      vi.mocked(mockContext.globalState.get).mockImplementation((key: string, def: any) => {
        if (key === "ulw.hasAutoEnabledKeybindings") return true;
        return def;
      });

      await lifecycle.activate(mockContext);

      expect(mockContext.globalState.get).toHaveBeenCalledWith(
        "ulw.hasAutoEnabledKeybindings",
        false,
      );
      // ensure no auto-enable update happened for this path (default getConfiguration mock has update)
      // we can check globalState update not called for the flag
      expect(mockContext.globalState.update).not.toHaveBeenCalledWith(
        "ulw.hasAutoEnabledKeybindings",
        true,
      );
    });

    it("should catch and swallow errors from config.update (error path)", async () => {
      const failingUpdate = vi.fn().mockRejectedValue(new Error("update failed for test"));
      const warnSpy = vi.fn();
      // pre-set a logger so the ?.warn call actually evaluates the template literal on line 588
      Reflect.set(lifecycle, "outputChannelService", { warn: warnSpy });

      vi.mocked(vscode.workspace.getConfiguration).mockImplementation((section) => {
        if (section === "ulw") {
          return {
            inspect: vi.fn(() => undefined),
            update: failingUpdate,
            get: vi.fn(),
          } as any;
        }
        return { get: vi.fn(), update: vi.fn(), inspect: vi.fn() } as any;
      });

      // should not throw even on failure inside ensure
      await expect(lifecycle.activate(mockContext)).resolves.not.toThrow();
      expect(failingUpdate).toHaveBeenCalledWith(
        "sendKeybindingsToShell",
        true,
        vscode.ConfigurationTarget.Global,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to auto-enable sendKeybindingsToShell"),
      );
    });

    it("should no-op early when context is falsy (line 549 guard)", async () => {
      // ensure the defensive early return is covered
      Reflect.set(lifecycle, "context", undefined);
      await expect(
        (lifecycle as any).ensureSendKeybindingsToShellDefault(),
      ).resolves.toBeUndefined();
    });

    it("should stringify non-Error rejection in catch (covers ternary false branch at 588)", async () => {
      const failingUpdate = vi.fn().mockRejectedValue("string failure for coverage");
      const warnSpy = vi.fn();
      Reflect.set(lifecycle, "outputChannelService", { warn: warnSpy });

      vi.mocked(vscode.workspace.getConfiguration).mockImplementation((section) => {
        if (section === "ulw") {
          return {
            inspect: vi.fn(() => undefined),
            update: failingUpdate,
            get: vi.fn(),
          } as any;
        }
        return { get: vi.fn(), update: vi.fn(), inspect: vi.fn() } as any;
      });

      await expect(lifecycle.activate(mockContext)).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("string failure for coverage"),
      );
    });

    it("should auto-enable when no explicit user value exists and not already enabled", async () => {
      const updateMock = vi.fn().mockResolvedValue(undefined);
      const globalStateUpdateMock = vi.fn().mockResolvedValue(undefined);
      const infoSpy = vi.fn();

      Reflect.set(lifecycle, "outputChannelService", { info: infoSpy });
      vi.mocked(mockContext.globalState.get).mockImplementation((key: string, def: any) => {
        if (key === "ulw.hasAutoEnabledKeybindings") return false;
        return def;
      });
      vi.mocked(mockContext.globalState.update).mockImplementation(globalStateUpdateMock);
      vi.mocked(vscode.workspace.getConfiguration).mockImplementation((section) => {
        if (section === "ulw") {
          return {
            inspect: vi.fn(() => ({})),
            update: updateMock,
            get: vi.fn(),
          } as any;
        }
        return { get: vi.fn(), update: vi.fn(), inspect: vi.fn() } as any;
      });

      await lifecycle.activate(mockContext);

      expect(updateMock).toHaveBeenCalledWith(
        "sendKeybindingsToShell",
        true,
        vscode.ConfigurationTarget.Global,
      );
      expect(globalStateUpdateMock).toHaveBeenCalledWith(
        "ulw.hasAutoEnabledKeybindings",
        true,
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("Automatically enabled 'sendKeybindingsToShell: true'"),
      );
    });
  });
});
