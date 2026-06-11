import * as vscode from "vscode";
import { TerminalProvider } from "../providers/TerminalProvider";
import { OpenCodeCodeActionProvider } from "../providers/CodeActionProvider";
import { TerminalManager } from "../terminals/TerminalManager";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { ContextSharingService } from "../services/ContextSharingService";
import { ContextManager } from "../services/ContextManager";
import { OutputChannelService } from "../services/OutputChannelService";
import { InstanceDiscoveryService } from "../services/InstanceDiscoveryService";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { InstanceStore } from "../services/InstanceStore";
import { InstanceRegistry } from "../services/InstanceRegistry";
import { ThreadHistoryStore } from "../services/ThreadHistoryStore";
import { InstanceQuickPick } from "../services/InstanceQuickPick";
import { InstanceController } from "../services/InstanceController";
import { CodexIdeContextService } from "../services/CodexIdeContextService";
import { SessionWindowHandoffService } from "../services/SessionWindowHandoffService";
import { NativeTerminalManager } from "../services/NativeTerminalManager";
import { PortManager } from "../services/PortManager";
import { ConnectionResolver } from "../services/ConnectionResolver";
import { TmuxSessionManager } from "../services/TmuxSessionManager";
import { ZellijSessionManager } from "../services/ZellijSessionManager";
import { TmuxPaneSyncService } from "../services/TmuxPaneSyncService";
import { ZellijPaneSyncService } from "../services/ZellijPaneSyncService";
import {
  StaticTerminalBackend,
  TerminalBackendRegistry,
} from "../services/terminalBackends";
import {
  registerCommands as registerAllCommands,
  type RegisterCommandDependencies,
} from "./commands";

/**
 * Manages extension activation, service initialization, and cleanup.
 */
export class ExtensionLifecycle {
  private terminalManager: TerminalManager | undefined;
  private tuiProvider: TerminalProvider | undefined;
  private captureManager: OutputCaptureManager | undefined;
  private contextSharingService: ContextSharingService | undefined;
  private outputChannelService: OutputChannelService | undefined;
  private contextManager: ContextManager | undefined;
  private instanceDiscoveryService: InstanceDiscoveryService | undefined;
  private codeActionProvider: OpenCodeCodeActionProvider | undefined;
  private instanceStore: InstanceStore | undefined;
  private instanceRegistry: InstanceRegistry | undefined;
  private threadHistoryStore: ThreadHistoryStore | undefined;
  private instanceQuickPick: InstanceQuickPick | undefined;
  private instanceController: InstanceController | undefined;
  private codexIdeContextService: CodexIdeContextService | undefined;
  private portManager: PortManager | undefined;
  private tmuxSessionManager: TmuxSessionManager | undefined;
  private zellijSessionManager: ZellijSessionManager | undefined;
  private tmuxPaneSyncService: TmuxPaneSyncService | undefined;
  private zellijPaneSyncService: ZellijPaneSyncService | undefined;
  private backendRegistry: TerminalBackendRegistry | undefined;
  private activated = false;
  private tuiProviderRegistration: vscode.Disposable | undefined;
  private context?: vscode.ExtensionContext;

  private static readonly TERMINAL_ID = "opencode-main";

  /** Returns the terminal ID for the active instance, falling back to the static default. */
  private getActiveTerminalId(): string {
    try {
      const active = this.instanceStore?.getActive();
      if (active?.runtime.terminalKey) {
        this.outputChannelService?.info(
          `[DIAG:getActiveTerminalId] resolved terminalKey="${active.runtime.terminalKey}" for instance="${active.config.id}" tmuxSession="${active.runtime.tmuxSessionId}"`,
        );
        return active.runtime.terminalKey;
      }
      if (active) {
        this.outputChannelService?.warn(
          `[DIAG:getActiveTerminalId] NO terminalKey for instance="${active.config.id}", falling back to config.id="${active.config.id}"`,
        );
        return active.config.id;
      }
      this.outputChannelService?.warn(
        `[DIAG:getActiveTerminalId] NO active instance, falling back to TERMINAL_ID="${ExtensionLifecycle.TERMINAL_ID}"`,
      );
      return ExtensionLifecycle.TERMINAL_ID;
    } catch (err) {
      this.outputChannelService?.error(
        `[DIAG:getActiveTerminalId] ERROR: ${err instanceof Error ? err.message : String(err)}`,
      );
      return ExtensionLifecycle.TERMINAL_ID;
    }
  }

  private resolveActiveTmuxSessionId(): string | undefined {
    try {
      return this.instanceStore?.getActive()?.runtime.tmuxSessionId;
    } catch {
      return undefined;
    }
  }

  async activate(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    const logger = OutputChannelService.getInstance();
    if (this.activated) {
      logger.warn(
        "[ExtensionLifecycle] activate() called while already active - skipping to prevent double provider registration",
      );
      return;
    }
    this.activated = true;
    logger.info("Initializing ULW...");

    // One-time setup on fresh install: auto-enable sendKeybindingsToShell
    // so Ctrl+P / Ctrl+other keys go to the sidebar opencode terminal immediately.
    await this.ensureSendKeybindingsToShellDefault();

    try {
      this.terminalManager = new TerminalManager();

      this.captureManager = new OutputCaptureManager();
      this.contextSharingService = new ContextSharingService();
      this.outputChannelService = logger;
      this.contextManager = new ContextManager(this.outputChannelService);
      this.instanceDiscoveryService = new InstanceDiscoveryService();
      this.codexIdeContextService = new CodexIdeContextService(logger);
      try {
        await this.codexIdeContextService.start();
        context.subscriptions.push(this.codexIdeContextService);
      } catch (error) {
        logger.warn(
          `[ExtensionLifecycle] Codex IDE context provider unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      this.instanceStore = new InstanceStore();
      this.threadHistoryStore = new ThreadHistoryStore(context.globalState);
      this.portManager = PortManager.getInstance(this.instanceStore);
      const tmuxSessionManager = new TmuxSessionManager(logger);
      if (await tmuxSessionManager.isAvailable()) {
        this.tmuxSessionManager = tmuxSessionManager;
      } else {
        logger.info(
          "[ExtensionLifecycle] tmux not detected; tmux backend unavailable",
        );
      }

      const zellijSessionManager = new ZellijSessionManager(logger);
      if (await zellijSessionManager.isAvailable()) {
        this.zellijSessionManager = zellijSessionManager;
      } else {
        logger.info(
          "[ExtensionLifecycle] zellij not detected; zellij backend unavailable",
        );
      }

      if (this.tmuxSessionManager) {
        this.tmuxPaneSyncService = new TmuxPaneSyncService(
          this.tmuxSessionManager,
        );
      }
      this.zellijPaneSyncService = new ZellijPaneSyncService();

      this.backendRegistry = new TerminalBackendRegistry([
        new StaticTerminalBackend("native", "Native", true),
        new StaticTerminalBackend("tmux", "Tmux", !!this.tmuxSessionManager),
        new StaticTerminalBackend(
          "zellij",
          "Zellij",
          !!this.zellijSessionManager,
        ),
      ]);
      const nativeTerminalManager = new NativeTerminalManager(logger);
      this.instanceRegistry = new InstanceRegistry(context);
      this.instanceRegistry.hydrate(this.instanceStore);

      context.subscriptions.push(this.contextManager);
      context.subscriptions.push(this.instanceDiscoveryService);
      this.instanceQuickPick = new InstanceQuickPick(
        this.instanceStore,
        this.instanceDiscoveryService,
      );

      const connectionResolver = new ConnectionResolver(
        this.instanceStore,
        this.instanceDiscoveryService,
        undefined,
        logger,
      );
      this.instanceController = new InstanceController(
        this.terminalManager,
        this.instanceStore,
        this.portManager,
        logger,
        connectionResolver,
      );

      context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
          this.captureManager?.cleanup(terminal);
        }),
      );

      this.tuiProvider = new TerminalProvider(
        context,
        this.terminalManager,
        this.captureManager,
        this.portManager,
        this.instanceStore,
        this.tmuxSessionManager,
        this.zellijSessionManager,
        this.backendRegistry,
        nativeTerminalManager,
        this.tmuxPaneSyncService,
        this.zellijPaneSyncService,
      );

      // Register webview provider — guard against double-registration on fast
      // reload (build-and-install) where the previous context.subscriptions may
      // not yet be disposed when the new activation begins.
      this.tuiProviderRegistration?.dispose();
      this.tuiProviderRegistration = undefined;
      try {
        const providerRegistration = vscode.window.registerWebviewViewProvider(
          TerminalProvider.viewType,
          this.tuiProvider,
          {
            webviewOptions: {
              retainContextWhenHidden: true,
            },
          },
        );
        this.tuiProviderRegistration = providerRegistration;
        context.subscriptions.push(providerRegistration);
        context.subscriptions.push(
          vscode.window.registerWebviewPanelSerializer(
            TerminalProvider.panelViewType,
            this.tuiProvider,
          ),
        );
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("already registered")
        ) {
          logger.warn(
            `[ExtensionLifecycle] ${TerminalProvider.viewType} provider already registered — prior activation still active. Terminal will attach on next view reveal.`,
          );
        } else {
          throw err;
        }
      }

      this.registerCommands(context);

      // Consume pending session window handoff (from dashboard "open in new window")
      await this.consumeSessionHandoff(context);

      this.codeActionProvider = new OpenCodeCodeActionProvider(
        this.contextManager,
        (prompt) => this.sendPromptToOpenCode(prompt),
      );

      const codeActionRegistration =
        vscode.languages.registerCodeActionsProvider(
          "*",
          this.codeActionProvider,
          {
            providedCodeActionKinds:
              OpenCodeCodeActionProvider.providedCodeActionKinds,
          },
        );
      const explainAndFixCommand = this.codeActionProvider.registerCommand();
      context.subscriptions.push(codeActionRegistration, explainAndFixCommand);

      // Expose that the extension is fully active so editor/title buttons
      // (openTerminalInEditor, etc.) only appear after
      // commands are registered. This prevents "command not found" errors.
      await vscode.commands.executeCommand("setContext", "ulw.active", true);

      logger.info("ULW activated successfully");
    } catch (error) {
      logger.error(
        `Failed to activate ULW: ${error instanceof Error ? error.message : String(error)}`,
      );
      vscode.window.showErrorMessage(
        `Failed to activate ULW: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getCommandDependencies(): RegisterCommandDependencies {
    const self = this;
    return {
      get context() {
        return self.context;
      },
      get provider() {
        return self.tuiProvider;
      },
      get tmuxManager() {
        return self.tmuxSessionManager;
      },
      get zellijManager() {
        return self.zellijSessionManager;
      },
      get terminalManager() {
        return self.terminalManager;
      },
      get contextSharingService() {
        return self.contextSharingService;
      },
      get contextManager() {
        return self.contextManager;
      },
      get instanceStore() {
        return self.instanceStore;
      },
      get instanceController() {
        return self.instanceController;
      },
      get instanceQuickPick() {
        return self.instanceQuickPick;
      },
      get outputChannel() {
        return self.outputChannelService;
      },
      getActiveTerminalId: () => this.getActiveTerminalId(),
      sendTerminalCwd: () => this.sendTerminalCwd(),
      sendPrompt: (prompt: string) =>
        this.tuiProvider?.sendPrompt(prompt) ?? Promise.resolve(),
      resolveActiveTmuxSessionId: () => this.resolveActiveTmuxSessionId(),
      resolveActiveTmuxFocus: () =>
        this.tmuxSessionManager?.getActiveFocus() ?? Promise.resolve(undefined),
      resolveWorkspacePath: () =>
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? undefined,
    };
  }

  private registerCommands(context: vscode.ExtensionContext): void {
    registerAllCommands(context, this.getCommandDependencies());
  }

  private async consumeSessionHandoff(
    context: vscode.ExtensionContext,
  ): Promise<void> {
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
    if (!workspaceUri || !this.instanceStore) {
      return;
    }

    const handoffService = new SessionWindowHandoffService(context);
    const handoff = await handoffService.consumeHandoff(workspaceUri);
    if (!handoff) {
      return;
    }

    const logger = this.outputChannelService ?? OutputChannelService.getInstance();
    logger.info(
      `[ExtensionLifecycle] Consuming session handoff: sessionId=${handoff.sessionId} backend=${handoff.backend}`,
    );

    const instanceId = `window-${Date.now()}-${handoff.backend}-${handoff.sessionId}`;
    this.instanceStore.upsert({
      config: {
        id: instanceId,
        workspaceUri: handoff.workspaceUri,
        label: handoff.label ?? `${handoff.sessionId} (${handoff.backend})`,
        terminalBackend: handoff.backend,
      },
      runtime: {
        terminalBackend: handoff.backend,
        tmuxSessionId: handoff.backend === "tmux" ? handoff.sessionId : undefined,
        zellijSessionId:
          handoff.backend === "zellij" ? handoff.sessionId : undefined,
      },
      state: "disconnected",
    });
    this.instanceStore.setActive(instanceId);

    // Trigger sidebar view — auto-start flow will pick up the active instance
    void Promise.resolve(vscode.commands.executeCommand("ulw.focus")).catch(
      (error: unknown) => {
        logger.warn(
          `[ExtensionLifecycle] Focus after handoff failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  }

  private async sendPromptToOpenCode(prompt: string): Promise<void> {
    if (!this.tuiProvider || !this.terminalManager) {
      throw new Error("OpenCode provider is not initialized");
    }

    if (!this.terminalManager.getTerminal(this.getActiveTerminalId())) {
      const sentByDiscovery =
        await this.trySendPromptViaDiscoveredInstance(prompt);
      if (sentByDiscovery) {
        return;
      }

      await this.tuiProvider.startAtConfiguredLocation();
    }

    const apiClient = this.tuiProvider.getApiClient();
    if (apiClient && this.tuiProvider.isHttpAvailable()) {
      try {
        await apiClient.appendPrompt(prompt);
      } catch (error) {
        this.outputChannelService?.warn(
          `Failed to send prompt via HTTP API, falling back to terminal input: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.terminalManager.writeToTerminal(
          this.getActiveTerminalId(),
          `${prompt}\n`,
        );
      }
    } else {
      this.terminalManager.writeToTerminal(
        this.getActiveTerminalId(),
        `${prompt}\n`,
      );
    }

    const config = vscode.workspace.getConfiguration("ulw");
    if (config.get<boolean>("autoFocusOnSend", true)) {
      vscode.commands.executeCommand("ulw.focus");
      setTimeout(() => {
        if (typeof this.tuiProvider?.focus === "function") {
          this.tuiProvider.focus();
        }
      }, 100);
    }
  }

  private async trySendPromptViaDiscoveredInstance(
    prompt: string,
  ): Promise<boolean> {
    if (!this.instanceDiscoveryService) {
      return false;
    }

    try {
      const discovered =
        await this.instanceDiscoveryService.discoverInstances();
      const primary = discovered[0];
      if (!primary) {
        return false;
      }

      const client = new OpenCodeApiClient(primary.port, 3, 200, 3000);
      await client.appendPrompt(prompt);
      this.outputChannelService?.info(
        `Sent prompt via discovered OpenCode instance on port ${primary.port}`,
      );
      return true;
    } catch (error) {
      this.outputChannelService?.warn(
        `Failed to send prompt via discovered instance: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private sendTerminalCwd(): void {
    const activeTerminal = vscode.window.activeTerminal;
    if (!activeTerminal) {
      vscode.window.showWarningMessage("No active terminal");
      return;
    }

    const cwd = activeTerminal.shellIntegration?.cwd?.fsPath;
    if (!cwd) {
      vscode.window.showWarningMessage(
        "Could not determine terminal working directory. Make sure shell integration is enabled.",
      );
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const reference =
      workspaceFolders && workspaceFolders.length > 0
        ? `@${vscode.workspace.asRelativePath(cwd, false)}`
        : `@${cwd}`;

    this.terminalManager?.writeToTerminal(
      this.getActiveTerminalId(),
      reference + " ",
    );

    const config = vscode.workspace.getConfiguration("ulw");
    if (config.get<boolean>("autoFocusOnSend", true)) {
      setTimeout(() => {
        void this.tuiProvider?.focusExistingTarget?.();
      }, 100);
    }
  }

  private async promptKillTmuxSessions(): Promise<void> {
    if (!this.tmuxSessionManager) {
      return;
    }

    const allSessions = await this.tmuxSessionManager.discoverSessions();

    if (allSessions.length === 0) {
      return;
    }

    const count = allSessions.length;
    const answer = await vscode.window.showWarningMessage(
      `${count} tmux ${count === 1 ? "session is" : "sessions are"} running. Kill ${count === 1 ? "it" : "them"} when closing VS Code?`,
      { modal: true },
      "Kill Sessions",
      "Keep Running",
    );

    if (answer === "Kill Sessions") {
      const instanceSessionIds = new Set(
        this.instanceStore
          ?.getAll()
          .map((r) => r.runtime.tmuxSessionId)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ) ?? [],
      );

      await Promise.allSettled(
        allSessions.map((session) => {
          if (instanceSessionIds.has(session.id)) {
            return (
              this.tuiProvider?.killTmuxSession(session.id) ?? Promise.resolve()
            );
          }
          return this.tmuxSessionManager!.killSession(session.id);
        }),
      );
    }
  }

  async deactivate(): Promise<void> {
    this.outputChannelService?.info("Deactivating ULW...");
    this.activated = false;

    if (this.tuiProviderRegistration) {
      this.tuiProviderRegistration.dispose();
      this.tuiProviderRegistration = undefined;
    }

    if (this.tuiProvider) {
      this.tuiProvider.dispose();
      this.tuiProvider = undefined;
    }

    if (this.tmuxPaneSyncService) {
      this.tmuxPaneSyncService.dispose();
      this.tmuxPaneSyncService = undefined;
    }

    if (this.zellijPaneSyncService) {
      this.zellijPaneSyncService.dispose();
      this.zellijPaneSyncService = undefined;
    }

    if (this.terminalManager) {
      this.terminalManager.dispose();
      this.terminalManager = undefined;
    }

    const logger = this.outputChannelService;

    if (this.outputChannelService) {
      this.outputChannelService.dispose();
      this.outputChannelService = undefined;
      OutputChannelService.resetInstance();
    }

    if (this.contextManager) {
      this.contextManager.dispose();
      this.contextManager = undefined;
    }

    if (this.instanceDiscoveryService) {
      this.instanceDiscoveryService.dispose();
      this.instanceDiscoveryService = undefined;
    }

    if (this.instanceRegistry) {
      this.instanceRegistry.dispose();
      this.instanceRegistry = undefined;
    }

    if (this.instanceStore) {
      this.instanceStore = undefined;
    }

    this.codeActionProvider = undefined;

    this.captureManager = undefined;
    this.contextSharingService = undefined;
    this.tmuxPaneSyncService = undefined;
    this.zellijPaneSyncService = undefined;

    // Clear the context key so editor/title buttons disappear cleanly
    try {
      await vscode.commands.executeCommand("setContext", "ulw.active", false);
    } catch {
      // intentionally empty: setContext during deactivation is best-effort
    }

    logger?.info("ULW deactivated");
  }

  /**
   * On first installation / activation, automatically enable
   * `sendKeybindingsToShell` so that Ctrl+P and other TUI shortcuts
   * work immediately in the sidebar terminal without the user having
   * to manually edit settings.
   *
   * We only do this if the user has never explicitly set the value
   * (we respect their choice if they turned it off).
   */
  private async ensureSendKeybindingsToShellDefault(): Promise<void> {
    if (!this.context) return;

    const config = vscode.workspace.getConfiguration("ulw");
    const inspect = config.inspect<boolean>("sendKeybindingsToShell");

    const userHasExplicitValue =
      inspect?.globalValue !== undefined ||
      inspect?.workspaceValue !== undefined ||
      inspect?.workspaceFolderValue !== undefined;

    if (userHasExplicitValue) {
      return; // respect user's choice
    }

    const alreadyAutoEnabled = this.context.globalState.get<boolean>(
      "ulw.hasAutoEnabledKeybindings",
      false,
    );

    if (alreadyAutoEnabled) {
      return;
    }

    try {
      await config.update(
        "sendKeybindingsToShell",
        true,
        vscode.ConfigurationTarget.Global,
      );
      await this.context.globalState.update(
        "ulw.hasAutoEnabledKeybindings",
        true,
      );

      this.outputChannelService?.info(
        "[ExtensionLifecycle] Automatically enabled 'sendKeybindingsToShell: true' on first install so Ctrl+P / TUI keys work in the sidebar terminal out of the box.",
      );
    } catch (err) {
      this.outputChannelService?.warn(
        `[ExtensionLifecycle] Failed to auto-enable sendKeybindingsToShell: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
