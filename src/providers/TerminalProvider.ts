import * as vscode from "vscode";
import { TerminalManager } from "../terminals/TerminalManager";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { PortManager } from "../services/PortManager";
import { ContextSharingService } from "../services/ContextSharingService";
import { OutputChannelService } from "../services/OutputChannelService";
import { DataThrottleService } from "../services/DataThrottleService";
import { InstanceId, InstanceStore } from "../services/InstanceStore";
import { PaneStore } from "../services/PaneStore";
import { TmuxSessionManager } from "../services/TmuxSessionManager";
import { AiToolFileReference } from "../services/aiTools/AiToolOperator";
import { TmuxPaneSyncService } from "../services/TmuxPaneSyncService";
import { ZellijPaneSyncService } from "../services/ZellijPaneSyncService";
import {
  AiToolConfig,
  BackendPaneConfig,
  HostMessage,
  TMUX_RAW_ALLOWED_SUBCOMMANDS,
  TerminalBackendType,
  detectAiToolName,
  resolveAiToolConfigs,
} from "../types";
import type { TmuxRawSubcommand } from "../types";
import { AiToolOperatorRegistry } from "../services/aiTools/AiToolOperatorRegistry";
import { MessageRouter, MessageRouterProviderBridge } from "./MessageRouter";
import { SessionRuntime, type SessionState } from "./SessionRuntime";
import { renderTerminalHtml } from "../webview/terminal/html";
import { ZellijSessionManager } from "../services/ZellijSessionManager";
import { NativeTerminalManager } from "../services/NativeTerminalManager";
import { TerminalBackendRegistry } from "../services/terminalBackends";
import { formatActiveSessionLabel } from "../utils/activeSessionLabel";

type TerminalDefaultLocation = "editor" | "sidebar";

export class TerminalProvider
  implements vscode.WebviewViewProvider, vscode.WebviewPanelSerializer
{
  public static readonly viewType = "ulw";
  public static readonly panelViewType = "ulw.terminalEditor";

  private _view?: vscode.WebviewView;
  private _panel?: vscode.WebviewPanel;
  private readonly editorPanels = new Set<vscode.WebviewPanel>();
  private readonly editorPanelPaneIds = new Map<vscode.WebviewPanel, string>();
  private readonly contextSharingService: ContextSharingService;
  private readonly logger = OutputChannelService.getInstance();
  private readonly aiToolRegistry: AiToolOperatorRegistry;
  private readonly sessionRuntime: SessionRuntime;
  private readonly messageRouter: MessageRouter;
  private readonly dataThrottleService: DataThrottleService;
  private readonly paneStore = new PaneStore();
  private readonly pendingWebviewMessages: HostMessage[] = [];
  private pendingQueueablePostChecks = 0;
  private nextEditorPaneIndex = 1;
  private static readonly DEFAULT_PANE_ID = "default";
  private static readonly EDITOR_PANE_PREFIX = "ulw-editor";
  private static readonly DEFAULT_TAB_ID = "default";

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly terminalManager: TerminalManager,
    private readonly captureManager: OutputCaptureManager,
    private readonly portManager: PortManager = PortManager.getInstance(),
    private readonly instanceStore?: InstanceStore,
    private readonly tmuxSessionManager?: TmuxSessionManager,
    private readonly zellijSessionManager?: ZellijSessionManager,
    private readonly backendRegistry: TerminalBackendRegistry = new TerminalBackendRegistry([
      { type: "native", label: "Native", isAvailable: () => true },
      { type: "tmux", label: "Tmux", isAvailable: () => !!tmuxSessionManager },
      { type: "zellij", label: "Zellij", isAvailable: () => !!zellijSessionManager },
    ]),
    private readonly nativeTerminalManager?: NativeTerminalManager,
    private readonly tmuxPaneSyncService?: TmuxPaneSyncService,
    // zellijPaneSyncService: reserved for Phase 3 zellij pane sync operations
    private readonly _zellijPaneSyncService?: ZellijPaneSyncService,
  ) {
    this.contextSharingService = new ContextSharingService();
    this.aiToolRegistry = new AiToolOperatorRegistry();
    this.dataThrottleService = new DataThrottleService((batch) => {
      for (const item of batch) {
        this.postWebviewMessageNow({
          type: "terminalOutput",
          data: item.data,
          paneId: item.paneId,
        });
      }
    });

    this.sessionRuntime = new SessionRuntime(
      this.terminalManager,
      this.captureManager,
      undefined,
      this.portManager,
      this.tmuxSessionManager,
      this.zellijSessionManager,
      this.backendRegistry,
      this.instanceStore,
      this.logger,
      this.contextSharingService,
      this.aiToolRegistry,
      {
        postMessage: (message) => this.postWebviewMessage(message),
        onActiveInstanceChanged: (instanceId) => {
          void this.switchToInstance(instanceId);
        },
        requestStartOpenCode: () => this.startOpenCode(),
      },
      this.nativeTerminalManager,
    );

    const routerBridge: MessageRouterProviderBridge = {
      startOpenCode: () => this.startOpenCode(),
      switchToTmuxSession: (sessionId) => this.switchToTmuxSession(sessionId),
      switchToZellijSession: (sessionId) => this.switchToZellijSession(sessionId),
      killTmuxSession: (sessionId) => this.killTmuxSession(sessionId),
      createTmuxSession: () => this.createTmuxSession(),
      toggleDashboard: () => this.toggleDashboard(),
      toggleEditorAttachment: () => this.toggleEditorAttachment(),
      restart: () => this.restart(),
      switchToNativeShell: () => this.switchToNativeShell(),
      selectTerminalBackend: (backend) => this.selectTerminalBackend(backend),
      cycleTerminalBackend: () => this.cycleTerminalBackend(),
      pasteText: (text) => this.pasteText(text),
      getActiveInstanceId: () => this.getActiveInstanceId(),
      setLastKnownTerminalSize: (cols, rows) =>
        this.setLastKnownTerminalSize(cols, rows),
      getLastKnownTerminalSize: () => this.getLastKnownTerminalSize(),
      isStarted: () => this.isStarted(),
      resizeActiveTerminal: (cols, rows) =>
        this.resizeActiveTerminal(cols, rows),
      getActiveTerminalId: () => this.activeTerminalId,
      postWebviewMessage: (message) => this.postWebviewMessage(message),
      routeDroppedTextToTmuxPane: (text, dropCell) =>
        this.sessionRuntime.routeDroppedTextToTmuxPane(text, dropCell),
      formatDroppedFiles: (paths, useAtSyntax) =>
        this.sessionRuntime.formatDroppedFiles(paths, { useAtSyntax }),
      formatPastedImage: (tempPath) =>
        this.sessionRuntime.formatPastedImage(tempPath),
      launchAiTool: (sessionId, toolName, savePreference, targetPaneId) =>
        this.launchAiTool(sessionId, toolName, savePreference, targetPaneId),
      executeRawTmuxCommand: (subcommand, args) =>
        this.executeRawTmuxCommand(subcommand, args),
      zoomTmuxPane: () => this.zoomTmuxPane(),
      getSelectedTmuxSessionId: () => this.getSelectedTmuxSessionId(),
      isTmuxAvailable: () => !!this.tmuxSessionManager,
      isZellijAvailable: () => !!this.zellijSessionManager,
      getActiveBackend: () => this.sessionRuntime.getActiveBackend(),
      getBackendAvailability: () => this.sessionRuntime.getBackendAvailability(),
      switchPaneBackend: (paneId, backend) =>
        this.switchPaneBackend(paneId, backend),
    };

    this.messageRouter = new MessageRouter(
      routerBridge,
      this.context,
      this.terminalManager,
      this.captureManager,
      this.getApiClient(),
      this.contextSharingService,
      this.logger,
      this.instanceStore,
    );
  }

  private get activeInstanceId(): InstanceId {
    return this.sessionRuntime.getActiveInstanceId();
  }

  private get activeTerminalId(): string {
    return this.sessionRuntime.getActiveTerminalId();
  }

  public get lastKnownCols(): number {
    return this.sessionRuntime.getLastKnownTerminalSize().cols;
  }

  public set lastKnownCols(cols: number) {
    const size = this.sessionRuntime.getLastKnownTerminalSize();
    this.sessionRuntime.setLastKnownTerminalSize(cols, size.rows);
  }

  public get lastKnownRows(): number {
    return this.sessionRuntime.getLastKnownTerminalSize().rows;
  }

  public set lastKnownRows(rows: number) {
    const size = this.sessionRuntime.getLastKnownTerminalSize();
    this.sessionRuntime.setLastKnownTerminalSize(size.cols, rows);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    this.ensureDefaultPaneState();
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    const processAlive = this.sessionRuntime.hasLiveTerminalProcess();
    if (this.sessionRuntime.isStartedFlag() && !processAlive) {
      this.sessionRuntime.resetState();
    }

    webviewView.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message, TerminalProvider.DEFAULT_PANE_ID);
    });

    if (processAlive) {
      this.sessionRuntime.reconnectListeners();
    }

    this.postTerminalConfig();
    this.postCurrentSessionState(webviewView.webview);
    this.flushPendingWebviewMessages(webviewView.webview);

    const config = vscode.workspace.getConfiguration("ulw");
    const autoStartOnOpen = config.get<boolean>("autoStartOnOpen", true);
    const visibilityListener = webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        return;
      }

      const hadPendingMessages =
        this.pendingWebviewMessages.length > 0 ||
        this.pendingQueueablePostChecks > 0;
      this.flushPendingWebviewMessages(webviewView.webview);
      if (!hadPendingMessages) {
        this.postWebviewVisibleForKnownPanes();
        this.postTerminalConfig();
      }

      if (autoStartOnOpen && !this.isStarted()) {
        if (this.getNativeRestoreRecord()) {
          void this.promptNativeRestore().then((restored) => {
            if (!restored) {
              void this.startOpenCode();
            }
          });
        } else {
          void this.startOpenCode();
        }
        visibilityListener.dispose();
      }
    });
    webviewView.onDidDispose(() => visibilityListener.dispose());

    if (autoStartOnOpen) {
      if (webviewView.visible) {
        if (!this.isStarted()) {
          if (this.getNativeRestoreRecord()) {
            void this.promptNativeRestore().then((restored) => {
              if (!restored) {
                void this.startOpenCode();
              }
            });
          } else {
            void this.startOpenCode();
          }
        }
      }
    } else if (webviewView.visible && !this.isStarted()) {
      void this.promptNativeRestore();
    }
  }

  public focus(): void {
    this._panel?.reveal(vscode.ViewColumn.Active);
    this.postWebviewMessage({
      type: "focusTerminal",
      paneId: this.getFocusedPaneId(),
    });
  }

  public async startAtConfiguredLocation(): Promise<void> {
    if (this.getTerminalDefaultLocation() === "sidebar") {
      await this.startOpenCode();
      return;
    }

    await this.revealOrOpenEditorTab();
    if (!this.isStarted()) {
      await this.startOpenCode();
    }
  }

  public async focusAtConfiguredLocation(): Promise<void> {
    if (this.getTerminalDefaultLocation() === "sidebar") {
      await this.revealSidebarView();
      return;
    }

    await this.revealOrOpenEditorTab();
    this.focus();
  }

  public async toggleEditorAttachment(): Promise<void> {
    if (this.editorPanels.size > 0) {
      const panels = [...this.editorPanels];
      this.editorPanels.clear();
      this._panel = undefined;
      for (const panel of panels) {
        panel.dispose();
      }
      this.postTerminalConfig();
      await this.revealSidebarView();
      return;
    }

    this.openInEditorTab();
  }

  public async openInEditorTab(): Promise<void> {
    const config = vscode.workspace.getConfiguration("ulw");

    if (config.get<boolean>("collapseSecondaryBarOnEditorOpen", true)) {
      await vscode.commands.executeCommand(
        "workbench.action.closeAuxiliaryBar",
      );
    }

    const panel = vscode.window.createWebviewPanel(
      TerminalProvider.panelViewType,
      "ULW Terminal",
      vscode.ViewColumn.Beside,
      this.getEditorPanelOptions(),
    );

    this.initializeEditorPanel(panel);

    await vscode.commands.executeCommand("workbench.action.lockEditorGroup");
  }

  private async revealOrOpenEditorTab(): Promise<void> {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    await this.openInEditorTab();
  }

  private getTerminalDefaultLocation(): TerminalDefaultLocation {
    const config = vscode.workspace.getConfiguration("ulw");
    const configured = config.get<string>("terminal.defaultLocation", "editor");
    return configured === "sidebar" ? "sidebar" : "editor";
  }

  public async deserializeWebviewPanel(
    webviewPanel: vscode.WebviewPanel,
    _state: unknown,
  ): Promise<void> {
    this.initializeEditorPanel(webviewPanel);
  }

  public formatFileReference(reference: AiToolFileReference): string {
    return this.sessionRuntime.formatFileReference(reference);
  }

  public formatUriReference(uri: vscode.Uri): string {
    return this.formatFileReference({
      path: vscode.workspace.asRelativePath(uri, false),
    });
  }

  public formatEditorReference(editor: vscode.TextEditor): string {
    const relativePath = vscode.workspace.asRelativePath(
      editor.document.uri,
      false,
    );
    const selection = editor.selection;
    return this.formatFileReference({
      path: relativePath,
      selectionStart: selection.isEmpty ? undefined : selection.start.line + 1,
      selectionEnd: selection.isEmpty ? undefined : selection.end.line + 1,
    });
  }

  public pasteText(text: string): void {
    this.postWebviewMessage({
      type: "clipboardContent",
      text,
    });
  }

  public requestPaste(): void {
    this.postWebviewMessage({
      type: "requestPaste",
    });
  }

  public getApiClient(): OpenCodeApiClient | undefined {
    return this.sessionRuntime.getApiClient();
  }

  public isHttpAvailable(): boolean {
    return this.sessionRuntime.isHttpAvailable();
  }

  public async startOpenCode(): Promise<void> {
    await this.sessionRuntime.startOpenCode();
  }

  public restart(): void {
    this.sessionRuntime.restart();
  }

  public async switchToInstance(
    instanceId: InstanceId,
    options?: { forceRestart?: boolean },
  ): Promise<void> {
    await this.sessionRuntime.switchToInstance(instanceId, options);
  }

  public async switchToTmuxSession(sessionId: string): Promise<void> {
    await this.sessionRuntime.switchToTmuxSession(sessionId);
  }

  public async switchToZellijSession(sessionId: string): Promise<void> {
    await this.sessionRuntime.switchToZellijSession(sessionId);
  }

  public resolveInstanceIdFromSessionId(sessionId: string): InstanceId {
    return this.sessionRuntime.resolveInstanceIdFromSessionId(sessionId);
  }

  public async switchToNativeShell(): Promise<void> {
    await this.sessionRuntime.switchToNativeShell();
  }

  public async selectTerminalBackend(
    backend: TerminalBackendType,
  ): Promise<void> {
    await this.sessionRuntime.selectTerminalBackend(backend);
  }

  public async cycleTerminalBackend(): Promise<void> {
    await this.sessionRuntime.cycleTerminalBackend();
  }

  public async switchPaneBackend(
    paneId: string,
    backend: TerminalBackendType,
  ): Promise<void> {
    await this.sessionRuntime.switchPaneBackend(paneId, backend);
  }

  public async createTmuxSession(): Promise<string | undefined> {
    return this.sessionRuntime.createTmuxSession();
  }

  public async killTmuxSession(sessionId: string): Promise<void> {
    await this.sessionRuntime.killTmuxSession(sessionId);
  }

  public async executeRawTmuxCommand(
    subcommand: string,
    args: string[] = [],
  ): Promise<string> {
    if (this.sessionRuntime.getActiveBackend() !== "tmux") {
      throw new Error(
        "Raw tmux subcommands are only supported on the tmux backend",
      );
    }
    if (!this.tmuxSessionManager) {
      throw new Error("tmux session manager unavailable");
    }

    if (!this.isTmuxRawSubcommand(subcommand)) {
      throw new Error(`Unsupported tmux subcommand: ${subcommand}`);
    }

    const sessionId = this.instanceStore?.getActive()?.runtime.tmuxSessionId;
    if (!sessionId) {
      throw new Error("No active tmux session available");
    }

    const resolvedArgs = await this.resolveRawTmuxCommandArgs(subcommand, args);
    return this.tmuxSessionManager.executeRawCommand(
      sessionId,
      subcommand,
      resolvedArgs,
    );
  }

  public getSelectedTmuxSessionId(): string | undefined {
    return this.sessionRuntime.getSelectedTmuxSessionId();
  }

  public async zoomTmuxPane(): Promise<void> {
    await this.sessionRuntime.zoomTmuxPane();
  }

  public async sendPrompt(prompt: string): Promise<void> {
    const apiClient = this.sessionRuntime.getApiClient();
    if (apiClient && this.sessionRuntime.isHttpAvailable()) {
      try {
        await apiClient.appendPrompt(prompt);
        return;
      } catch (error) {
        this.logger.warn(
          `HTTP API send failed, falling back to terminal write: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.terminalManager.writeToTerminal(this.activeTerminalId, prompt);
  }

  public async launchAiTool(
    sessionId: string,
    toolName: string,
    savePreference: boolean,
    targetPaneId?: string,
    backendHint?: TerminalBackendType,
  ): Promise<void> {
    if (savePreference) {
      const config = vscode.workspace.getConfiguration("ulw");
      await config.update(
        "defaultAiTool",
        toolName,
        vscode.ConfigurationTarget.Global,
      );
    }

    const tool = this.sessionRuntime.resolveToolByName(toolName);
    if (!tool) {
      return;
    }

    const instanceId =
      this.sessionRuntime.resolveInstanceIdFromSessionId(sessionId);
    this.sessionRuntime.rememberSelectedTool(tool.name, instanceId);

    const operator = this.aiToolRegistry.getForConfig(tool);
    const launchCommand = operator.getLaunchCommand(tool);
    const instance = this.instanceStore?.get(instanceId);
    const activeBackend = this.sessionRuntime.getActiveBackend();
    const effectiveBackend: TerminalBackendType = backendHint
      ? backendHint
      : instance?.runtime.tmuxSessionId
        ? "tmux"
        : instance?.runtime.zellijSessionId
          ? "zellij"
          : activeBackend;

    try {
      if (effectiveBackend === "zellij") {
        if (!this.zellijSessionManager) {
          this.logger.warn(
            "[TerminalProvider] launchAiTool skipped: zellij manager unavailable",
          );
          return;
        }
        const effectiveZellijSessionId =
          this.sessionRuntime.resolveZellijSessionIdForInstance(instanceId) ??
          sessionId;
        if (typeof this.zellijSessionManager.switchSession === "function") {
          await this.zellijSessionManager.switchSession(effectiveZellijSessionId);
        }
        if (targetPaneId) {
          await this.zellijSessionManager.selectPane(targetPaneId);
        }
        await this.zellijSessionManager.sendTextToPane(launchCommand, {
          submit: true,
        });
        return;
      }

      if (effectiveBackend !== "tmux" || !this.tmuxSessionManager) {
        this.logger.warn(
          `[TerminalProvider] launchAiTool skipped: backend ${effectiveBackend} does not support pane targeting`,
        );
        return;
      }

      const effectiveSessionId =
        this.sessionRuntime.resolveTmuxSessionIdForInstance(instanceId) ??
        sessionId;
      let paneIdToUse: string | undefined = targetPaneId;
      if (!paneIdToUse) {
        const panes = await this.tmuxSessionManager.listPanes(
          effectiveSessionId,
          { activeWindowOnly: true },
        );
        const targetPane = panes.find((p) => p.isActive) ?? panes[0];
        paneIdToUse = targetPane?.paneId;
      }
      if (paneIdToUse) {
        await this.tmuxSessionManager.sendTextToPane(
          paneIdToUse,
          launchCommand,
        );
      } else {
        this.logger.warn(
          `[TerminalProvider] launchAiTool skipped: no target pane for session ${effectiveSessionId}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[TerminalProvider] Failed to launch AI tool: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private handleMessage(message: unknown, surfacePaneId?: string): void {
    const scopedMessage = this.withSurfacePaneId(message, surfacePaneId);
    if (this.isPaneScopedWebviewMessage(scopedMessage)) {
      this.dataThrottleService.setFocusedPane(this.normalizePaneId(scopedMessage.paneId));
    }

    if (this.isPaneCreateWebviewMessage(scopedMessage)) {
      void this.handlePaneCreate(scopedMessage);
      return;
    }

    if (this.isPaneDeleteWebviewMessage(scopedMessage)) {
      this.handlePaneDelete(scopedMessage);
      return;
    }

    if (this.isNonDefaultReadyMessage(scopedMessage)) {
      void this.handleNonDefaultPaneReady(scopedMessage);
      return;
    }

    this.messageRouter.handleMessage(scopedMessage);
  }

  private isTmuxRawSubcommand(value: string): value is TmuxRawSubcommand {
    return TMUX_RAW_ALLOWED_SUBCOMMANDS.some((command) => command === value);
  }

  private async resolveRawTmuxCommandArgs(
    subcommand: TmuxRawSubcommand,
    args: string[],
  ): Promise<string[]> {
    switch (subcommand) {
      case "rename-session":
        return this.promptForTmuxValue(
          "Rename tmux session",
          "Enter the new tmux session name",
          args[0],
        );
      case "rename-window":
        return this.promptForTmuxValue(
          "Rename tmux window",
          "Enter the new tmux window name",
          args[0],
        );
      case "select-layout":
        return this.promptForTmuxValue(
          "Select tmux layout",
          "Enter a tmux layout name (e.g. even-horizontal, tiled, main-vertical)",
          args[0],
        );
      default:
        return args;
    }
  }

  private async promptForTmuxValue(
    title: string,
    prompt: string,
    value?: string,
  ): Promise<string[]> {
    const input = await vscode.window.showInputBox({
      title,
      prompt,
      value,
      ignoreFocusOut: true,
      validateInput: (currentValue) =>
        currentValue.trim().length === 0 ? "A value is required" : undefined,
    });

    if (input === undefined) {
      throw new Error("tmux command cancelled");
    }

    return [input.trim()];
  }

  public async launchDefaultAiTool(
    sessionId: string,
    targetPaneId?: string,
    backendHint?: TerminalBackendType,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("ulw");
    const instanceId =
      this.sessionRuntime.resolveInstanceIdFromSessionId(sessionId);
    const effectiveSessionId =
      this.sessionRuntime.resolveTmuxSessionIdForInstance(instanceId) ??
      sessionId;
    const savedTool =
      this.instanceStore?.get(instanceId)?.config.selectedAiTool ??
      config.get<string>("defaultAiTool", "");
    const tools: AiToolConfig[] = resolveAiToolConfigs(
      config.get("aiTools", []),
    );

    const runningTool = this.tmuxSessionManager
      ? await this.detectRunningTmuxAiTool(effectiveSessionId, targetPaneId, tools)
      : undefined;
    if (runningTool) {
      this.sessionRuntime.rememberSelectedTool(runningTool, instanceId);
      return;
    }

    if (savedTool) {
      await this.launchAiTool(
        effectiveSessionId,
        savedTool,
        false,
        targetPaneId,
        backendHint,
      );
    }
  }

  private async detectRunningTmuxAiTool(
    sessionId: string,
    targetPaneId: string | undefined,
    tools: AiToolConfig[],
  ): Promise<string | undefined> {
    if (!this.tmuxSessionManager || !sessionId) {
      return undefined;
    }

    try {
      const panes = await this.tmuxSessionManager.listPanes(sessionId, {
        activeWindowOnly: true,
      });
      const targetPane = targetPaneId
        ? panes.find((pane) => pane.paneId === targetPaneId)
        : panes.find((pane) => pane.isActive);
      return detectAiToolName(targetPane?.currentCommand, tools);
    } catch {
      return undefined;
    }
  }

  private getNativeRestoreRecord():
    | ReturnType<InstanceStore["getActive"]>
    | undefined {
    let record: ReturnType<InstanceStore["getActive"]> | undefined;
    try {
      record = this.instanceStore?.getActive();
    } catch (error) {
      this.logger.info(
        `[TerminalProvider] Native restore skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }

    if (
      !record ||
      record.state !== "disconnected" ||
      record.config.terminalBackend !== "native" ||
      !record.config.selectedAiTool
    ) {
      return undefined;
    }

    return record;
  }

  private async promptNativeRestore(): Promise<boolean> {
    const record = this.getNativeRestoreRecord();

    if (!record) {
      return false;
    }

    const selectedAiTool = record.config.selectedAiTool;
    this.logger.info(
      `[TerminalProvider] Restoring native terminal for ${record.config.id}`,
    );
    this.sessionRuntime.rememberSelectedTool(selectedAiTool, record.config.id);
    await this.sessionRuntime.startOpenCode();
    return true;
  }

  private resizeActiveTerminal(cols: number, rows: number): void {
    this.terminalManager.resizeTerminal(this.activeTerminalId, cols, rows);
  }

  private async handlePaneCreate(message: {
    paneId?: string;
    direction?: "horizontal" | "vertical";
  }): Promise<void> {
    const paneId = this.normalizePaneId(message.paneId);
    if (paneId === TerminalProvider.DEFAULT_PANE_ID) {
      this.ensureDefaultPaneState();
      return;
    }

    if (!this.isMultiPaneSupportedBackend()) {
      return;
    }

    this.ensureDefaultPaneState();
    if (this.paneStore.getPane(paneId)) {
      this.setFocusedPane(paneId);
      return;
    }

    this.paneStore.addPane({
      paneId,
      tabId: this.paneStore.getActiveTab() ?? TerminalProvider.DEFAULT_TAB_ID,
      isActive: true,
      size: 100,
      splitDirection: message.direction,
    });
    this.setFocusedPane(paneId);

    try {
      const activeBackend = this.sessionRuntime.getActiveBackend();
      const backendConfig = this.resolveBackendConfig(activeBackend, paneId);
      await this.sessionRuntime.createSession(paneId, {
        paneId,
        backend: activeBackend,
        backendConfig,
      });

      if (activeBackend === "tmux" && this.tmuxPaneSyncService) {
        const tmuxSessionId = this.sessionRuntime.getSelectedTmuxSessionId?.() ?? this.sessionRuntime.getSession(TerminalProvider.DEFAULT_PANE_ID)?.tmuxSessionId;
        if (tmuxSessionId) {
          try {
            const direction = message.direction ?? "horizontal";
            await this.tmuxPaneSyncService.splitPane(tmuxSessionId, direction);
          } catch (error) {
            console.warn('[TerminalProvider] tmux split-pane sync failed', error);
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `[TerminalProvider] Failed to create pane session '${paneId}': ${error instanceof Error ? error.message : String(error)}`,
      );
      this.paneStore.removePane(paneId);
      this.setFocusedPane(this.getFocusedPaneId());
      this.postWebviewMessage({
        type: "terminalExited",
        paneId,
      });
    }
  }

  private handlePaneDelete(message: { paneId?: string }): void {
    const paneId = this.normalizePaneId(message.paneId);
    if (
      paneId === TerminalProvider.DEFAULT_PANE_ID ||
      !this.isMultiPaneSupportedBackend()
    ) {
      return;
    }

    this.sessionRuntime.destroySession(paneId);
    // Backend-specific cleanup is handled by destroySession
    // (tmux/zellij sessions are detached, not killed)
    this.paneStore.removePane(paneId);
    this.setFocusedPane(this.resolveNextPaneId());
    this.postWebviewMessage({
      type: "focusTerminal",
      paneId: this.getFocusedPaneId(),
    });
  }

  private async handleNonDefaultPaneReady(message: {
    cols: number;
    rows: number;
    paneId?: string;
  }): Promise<void> {
    const paneId = this.normalizePaneId(message.paneId);
    if (!this.isMultiPaneSupportedBackend()) {
      return;
    }

    this.ensureDefaultPaneState();
    if (!this.paneStore.getPane(paneId)) {
      this.paneStore.addPane({
        paneId,
        tabId: this.paneStore.getActiveTab() ?? TerminalProvider.DEFAULT_TAB_ID,
        isActive: true,
        size: 100,
      });
    }
    this.setFocusedPane(paneId);

    let sessionState = this.sessionRuntime.getSession(paneId);
    if (!sessionState) {
      const activeBackend = this.sessionRuntime.getActiveBackend();
      sessionState = await this.sessionRuntime.createSession(paneId, {
        paneId,
        backend: activeBackend,
        backendConfig: this.resolveBackendConfig(activeBackend, paneId),
      });
    }

    this.messageRouter.handleTerminalResize(message.cols, message.rows, paneId);
    if (sessionState) {
      this.postWebviewMessageNow(this.buildActiveSessionMessage(sessionState));
    }
    this.postPlatformInfo();
  }

  private getActiveInstanceId(): InstanceId {
    return this.activeInstanceId;
  }

  private setLastKnownTerminalSize(cols: number, rows: number): void {
    this.sessionRuntime.setLastKnownTerminalSize(cols, rows);
  }

  private getLastKnownTerminalSize(): { cols: number; rows: number } {
    return this.sessionRuntime.getLastKnownTerminalSize();
  }

  private isStarted(): boolean {
    return this.sessionRuntime.isStartedFlag();
  }

  private postWebviewMessage(message: unknown): void {
    this.updateViewTitle(message);

    if (this.isTerminalOutputHostMessage(message)) {
      this.dataThrottleService.push(
        this.normalizePaneId(message.paneId),
        message.data,
      );
      return;
    }

    if (this.isPaneScopedHostMessage(message)) {
      const paneId = this.normalizePaneId(message.paneId);
      if (message.type === "focusTerminal" || message.type === "webviewVisible") {
        this.dataThrottleService.setFocusedPane(paneId);
        this.dataThrottleService.flush();
      }

      this.postWebviewMessageNow({
        ...message,
        paneId,
      });
      return;
    }

    this.postWebviewMessageNow(message);
  }

  private updateViewTitle(message: unknown): void {
    if (!this._view || !this.isActiveSessionHostMessage(message)) {
      return;
    }

    const activeBackend = "backend" in message && message.backend
      ? message.backend
      : this.sessionRuntime.getActiveBackend();
    this._view.title = "ULW";
    this._view.description = formatActiveSessionLabel(message, activeBackend);
  }

  private postPlatformInfo(): void {
    this.postWebviewMessage({
      type: "platformInfo",
      platform: process.platform,
      tmuxAvailable: !!this.tmuxSessionManager,
      zellijAvailable: !!this.zellijSessionManager,
      backendAvailability: this.sessionRuntime.getBackendAvailability(),
      activeBackend: this.sessionRuntime.getActiveBackend(),
    });
  }

  private postWebviewVisibleForKnownPanes(): void {
    for (const paneId of this.getKnownPaneIds()) {
      this.postWebviewMessage({
        type: "webviewVisible",
        paneId,
      });
    }
  }

  private postWebviewMessageNow(message: unknown): void {
    const webviews = this.getTargetWebviews(message);
    if (webviews.length > 0) {
      let deliveredSynchronously = false;
      let pendingAsyncDelivery = false;
      for (const webview of webviews) {
        const postResult = webview.postMessage(message) as
          | boolean
          | Thenable<boolean>;
        if (this.isThenablePostResult(postResult)) {
          pendingAsyncDelivery = true;
          if (this.isQueueableHostMessage(message)) {
            this.pendingQueueablePostChecks += 1;
          }
          void postResult.then((delivered) => {
            if (this.isQueueableHostMessage(message)) {
              this.pendingQueueablePostChecks = Math.max(
                0,
                this.pendingQueueablePostChecks - 1,
              );
            }
            if (!delivered && this.isQueueableHostMessage(message)) {
              this.replacePendingWebviewMessage(message);
              if (this.isWebviewVisible()) {
                this.flushPendingWebviewMessages(webview);
              }
            }
          });
          continue;
        }

        if (postResult) {
          deliveredSynchronously = true;
        }
      }
      if (
        !deliveredSynchronously &&
        !pendingAsyncDelivery &&
        this.isQueueableHostMessage(message)
      ) {
        this.replacePendingWebviewMessage(message);
      }
      return;
    }

    if (this.isQueueableHostMessage(message)) {
      this.replacePendingWebviewMessage(message);
    }
  }

  private isWebviewVisible(): boolean {
    return (
      [...this.editorPanels].some((panel) => panel.visible === true) ||
      this._view?.visible === true
    );
  }

  private getTargetWebviews(message: unknown): vscode.Webview[] {
    const targetPaneId = this.getTargetPaneId(message);
    if (targetPaneId) {
      return this.getTargetWebviewsForPane(targetPaneId);
    }

    const webviews: vscode.Webview[] = [];
    if (this._view?.webview) {
      webviews.push(this._view.webview);
    }
    for (const panel of this.editorPanels) {
      webviews.push(panel.webview);
    }
    return webviews;
  }

  private getTargetWebviewsForPane(paneId: string): vscode.Webview[] {
    if (paneId === TerminalProvider.DEFAULT_PANE_ID) {
      return this._view?.webview ? [this._view.webview] : [];
    }

    const webviews: vscode.Webview[] = [];
    for (const panel of this.editorPanels) {
      if (this.editorPanelPaneIds.get(panel) === paneId) {
        webviews.push(panel.webview);
      }
    }
    return webviews;
  }

  private getTargetPaneId(message: unknown): string | undefined {
    if (this.isTerminalOutputHostMessage(message)) {
      return this.normalizePaneId(message.paneId);
    }
    if (this.isActiveSessionHostMessage(message)) {
      return this.normalizePaneId(message.paneId);
    }
    if (this.isPaneScopedHostMessage(message)) {
      return this.normalizePaneId(message.paneId);
    }
    return undefined;
  }

  private isThenablePostResult(
    value: boolean | Thenable<boolean>,
  ): value is Thenable<boolean> {
    return typeof value === "object" && value !== null && "then" in value;
  }

  private isTerminalOutputHostMessage(
    message: unknown,
  ): message is Extract<HostMessage, { type: "terminalOutput" }> {
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "terminalOutput" &&
      "data" in message &&
      typeof message.data === "string"
    );
  }

  private isActiveSessionHostMessage(
    message: unknown,
  ): message is Extract<HostMessage, { type: "activeSession" }> {
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "activeSession"
    );
  }

  private isPaneScopedHostMessage(
    message: unknown,
  ): message is Extract<
    HostMessage,
    {
      type:
        | "terminalExited"
        | "clearTerminal"
        | "focusTerminal"
        | "webviewVisible";
    }
  > {
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      (message.type === "terminalExited" ||
        message.type === "clearTerminal" ||
        message.type === "focusTerminal" ||
        message.type === "webviewVisible")
    );
  }

  private normalizePaneId(paneId: string | undefined): string {
    return paneId ?? TerminalProvider.DEFAULT_PANE_ID;
  }

  private assignEditorPanelPaneId(panel: vscode.WebviewPanel): string {
    const existingPaneId = this.editorPanelPaneIds.get(panel);
    if (existingPaneId) {
      return existingPaneId;
    }

    const paneId = `${TerminalProvider.EDITOR_PANE_PREFIX}-${this.nextEditorPaneIndex}`;
    this.nextEditorPaneIndex += 1;
    this.editorPanelPaneIds.set(panel, paneId);
    return paneId;
  }

  private withSurfacePaneId(
    message: unknown,
    surfacePaneId: string | undefined,
  ): unknown {
    const normalizedSurfacePaneId = this.normalizePaneId(surfacePaneId);
    if (
      normalizedSurfacePaneId === TerminalProvider.DEFAULT_PANE_ID ||
      !this.isPaneScopedWebviewMessage(message) ||
      typeof message.paneId === "string"
    ) {
      return message;
    }

    return {
      ...message,
      paneId: normalizedSurfacePaneId,
    };
  }

  private isPaneScopedWebviewMessage(
    message: unknown,
  ): message is { paneId?: string } {
    return typeof message === "object" && message !== null && "type" in message;
  }

  private isPaneCreateWebviewMessage(
    message: unknown,
  ): message is { type: "paneCreate"; paneId?: string; direction?: "horizontal" | "vertical" } {
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "paneCreate"
    );
  }

  private isPaneDeleteWebviewMessage(
    message: unknown,
  ): message is { type: "paneDelete"; paneId?: string } {
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "paneDelete"
    );
  }

  private isNonDefaultReadyMessage(
    message: unknown,
  ): message is { type: "ready"; cols: number; rows: number; paneId?: string } {
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "ready" &&
      this.normalizePaneId(
        "paneId" in message && typeof message.paneId === "string"
          ? message.paneId
          : undefined,
      ) !== TerminalProvider.DEFAULT_PANE_ID &&
      "cols" in message &&
      typeof message.cols === "number" &&
      "rows" in message &&
      typeof message.rows === "number"
    );
  }

  private isQueueableHostMessage(_message: unknown): _message is never {
    return false;
  }

  private replacePendingWebviewMessage(message: HostMessage): void {
    const existingIndex = this.pendingWebviewMessages.findIndex(
      (pendingMessage) => pendingMessage.type === message.type,
    );
    if (existingIndex >= 0) {
      this.pendingWebviewMessages.splice(existingIndex, 1, message);
      return;
    }

    this.pendingWebviewMessages.push(message);
  }

  private flushPendingWebviewMessages(webview: vscode.Webview): void {
    const messages = this.pendingWebviewMessages.splice(0);
    for (const message of messages) {
      const postResult = webview.postMessage(message) as
        | boolean
        | Thenable<boolean>;
      if (this.isThenablePostResult(postResult)) {
        void postResult.then((delivered) => {
          if (!delivered && this.isQueueableHostMessage(message)) {
            this.replacePendingWebviewMessage(message);
          }
        });
      } else if (!postResult && this.isQueueableHostMessage(message)) {
        this.replacePendingWebviewMessage(message);
      }
    }
  }

  private postCurrentSessionState(
    webview: vscode.Webview,
    paneId: string = TerminalProvider.DEFAULT_PANE_ID,
  ): void {
    const normalizedPaneId = this.normalizePaneId(paneId);
    if (normalizedPaneId !== TerminalProvider.DEFAULT_PANE_ID) {
      const session = this.sessionRuntime.getSession(normalizedPaneId);
      webview.postMessage(
        session
          ? this.buildActiveSessionMessage(session)
          : {
              type: "activeSession",
              backend: "native",
              paneId: normalizedPaneId,
            },
      );
      return;
    }

    const selectedSessionId = this.sessionRuntime.getSelectedTmuxSessionId();
    const resolvedSessionId =
      this.sessionRuntime.resolveTmuxSessionIdForInstance(
        this.getActiveInstanceId(),
      );
    const activeBackend = this.sessionRuntime.getActiveBackend();
    const zellijSessionId = this.sessionRuntime.resolveZellijSessionIdForInstance(
      this.getActiveInstanceId(),
    );
    const sessionId =
      activeBackend === "zellij"
        ? zellijSessionId
        : selectedSessionId ?? resolvedSessionId;
    const sessionBackend: TerminalBackendType = zellijSessionId
      ? "zellij"
      : sessionId
        ? "tmux"
        : "native";

    if (sessionId) {
      const message: HostMessage = {
        type: "activeSession",
        sessionName: sessionId,
        sessionId,
        backend: sessionBackend,
      };
      this.updateViewTitle(message);
      webview.postMessage(message);
      return;
    }

    const message: HostMessage = { type: "activeSession", backend: "native" };
    this.updateViewTitle(message);
    webview.postMessage(message);
  }

  private buildActiveSessionMessage(session: SessionState): HostMessage {
    if (session.tmuxSessionId) {
      return {
        type: "activeSession",
        sessionName: session.tmuxSessionId,
        sessionId: session.tmuxSessionId,
        backend: "tmux",
        paneId: session.paneId,
      };
    }
    if (session.zellijSessionId) {
      return {
        type: "activeSession",
        sessionName: session.zellijSessionId,
        sessionId: session.zellijSessionId,
        backend: "zellij",
        paneId: session.paneId,
      };
    }
    return {
      type: "activeSession",
      backend: session.backend,
      paneId: session.paneId,
    };
  }

  private getEditorPanelOptions(): vscode.WebviewOptions &
    vscode.WebviewPanelOptions {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.context.extensionUri],
    };
  }

  private initializeEditorPanel(panel: vscode.WebviewPanel): void {
    const paneId = this.assignEditorPanelPaneId(panel);
    this._panel = panel;
    this.editorPanels.add(panel);
    panel.webview.options = this.getEditorPanelOptions();
    this.ensurePaneState(paneId);
    panel.webview.html = this.getHtmlForWebview(panel.webview, paneId);

    const processAlive = this.sessionRuntime.hasLiveTerminalProcess();
    if (this.sessionRuntime.isStartedFlag() && !processAlive) {
      this.sessionRuntime.resetState();
    }

    panel.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message, paneId);
    });

    if (processAlive) {
      this.sessionRuntime.reconnectListeners();
    }

    this.postTerminalConfig();
    this.postCurrentSessionState(panel.webview, paneId);
    this.flushPendingWebviewMessages(panel.webview);

    panel.onDidDispose(() => {
      this.editorPanelPaneIds.delete(panel);
      this.editorPanels.delete(panel);
      if (this._panel === panel) {
        const remainingPanels = [...this.editorPanels];
        this._panel = remainingPanels[remainingPanels.length - 1];
        if (this._view) {
          this.postTerminalConfig();
          this.postWebviewVisibleForKnownPanes();
        }
      }
    });
  }

  private async revealSidebarView(): Promise<void> {
    try {
      await vscode.commands.executeCommand(
        "workbench.view.extension.ulwContainer",
      );
    } catch {
      // intentionally empty: sidebar reveal is best-effort
    }

    this._view?.show?.(true);
    this.postWebviewMessage({
      type: "focusTerminal",
      paneId: this.getFocusedPaneId(),
    });
  }

  private postTerminalConfig(): void {
    const terminalConfig = this.getTerminalConfig();
    this.postWebviewMessage({
      type: "terminalConfig",
      ...terminalConfig,
    });
  }

  private getTerminalConfig(): Omit<
    Extract<HostMessage, { type: "terminalConfig" }>,
    "type"
  > {
    const config = vscode.workspace.getConfiguration("ulw");
    return {
      fontSize: config.get<number>("fontSize", 14),
      fontFamily: config.get<string>(
        "fontFamily",
        "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'CascadiaCode NF', Menlo, monospace",
      ),
      cursorBlink: config.get<boolean>("cursorBlink", true),
      cursorStyle: config.get<"block" | "underline" | "bar">(
        "cursorStyle",
        "block",
      ),
      scrollback: config.get<number>("scrollback", 10000),
      sendKeybindingsToShell: config.get<boolean>(
        "sendKeybindingsToShell",
        true,
      ),
      renderer: config.get<"webgl" | "canvas" | "auto">(
        "pane.renderer",
        "auto",
      ),
      showTmuxWindowControls: config.get<boolean>(
        "showTmuxWindowControls",
        true,
      ),
    };
  }

  private getHtmlForWebview(
    webview: vscode.Webview,
    surfacePaneId = TerminalProvider.DEFAULT_PANE_ID,
  ): string {
    const scriptUri = webview
      .asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
      )
      .toString();
    const cssUri = webview
      .asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "terminal.css"),
      )
      .toString();
    const nonce = this.getNonce();
    const layoutCssUri = webview
      .asWebviewUri(
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "src",
          "webview",
          "layout",
          "layout-engine.css",
        ),
      )
      .toString();
    const tabBarCssUri = webview
      .asWebviewUri(
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "src",
          "webview",
          "tab-bar",
          "tab-bar.css",
        ),
      )
      .toString();
    const paneActionsCssUri = webview
      .asWebviewUri(
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "src",
          "webview",
          "pane-actions",
          "pane-actions.css",
        ),
      )
      .toString();
    const focusManagerCssUri = webview
      .asWebviewUri(
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "src",
          "webview",
          "focus",
          "focus-manager.css",
        ),
      )
      .toString();

    const terminalConfig = this.getTerminalConfig();

    const html = renderTerminalHtml({
      cspSource: webview.cspSource,
      nonce,
      cssUri,
      scriptUri,
      fontSize: String(terminalConfig.fontSize),
      fontFamily: terminalConfig.fontFamily,
      cursorBlink: String(terminalConfig.cursorBlink),
      cursorStyle: terminalConfig.cursorStyle,
      scrollback: String(terminalConfig.scrollback),
      sendKeybindingsToShell: String(terminalConfig.sendKeybindingsToShell),
      renderer: terminalConfig.renderer,
      showTmuxWindowControls: String(terminalConfig.showTmuxWindowControls),
    });

    const multiPaneCssLinks = [
      layoutCssUri,
      tabBarCssUri,
      paneActionsCssUri,
      focusManagerCssUri,
    ]
      .map((uri) => `<link rel="stylesheet" href="${uri}" />`)
      .join("\n    ");
    const bootstrapScript = `<script nonce="${nonce}">(() => {\n  const container = document.getElementById("terminal-container");\n  if (!container) {\n    return;\n  }\n\n  const surfacePaneId = "${surfacePaneId}";\n  window.__ULW_SURFACE_PANE_ID__ = surfacePaneId;\n\n  if (!document.getElementById("terminal-layout-root")) {\n    const root = document.createElement("div");\n    root.id = "terminal-layout-root";\n    root.className = "layout-root";\n    root.dataset.defaultPaneId = surfacePaneId;\n    container.parentElement?.insertBefore(root, container);\n    root.appendChild(container);\n  }\n\n  document.body.dataset.multiPaneBootstrap = "enabled";\n  window.__OPENCODE_TUI_MULTI_PANE__ = Object.freeze({\n    defaultPaneId: surfacePaneId,\n    components: [\n      "PaneManager",\n      "PaneMessageRouter",\n      "LayoutEngine",\n      "TabBar",\n      "PaneActions",\n      "FocusManager"\n    ]\n  });\n})();</script>`;

    return html
      .replace("</head>", `    ${multiPaneCssLinks}\n  </head>`)
      .replace(
        `<script nonce="${nonce}" src="${scriptUri}"></script>`,
        `${bootstrapScript}\n    <script nonce="${nonce}" src="${scriptUri}"></script>`,
      );
  }

  private ensureDefaultPaneState(): void {
    this.ensurePaneState(TerminalProvider.DEFAULT_PANE_ID);
  }

  private ensurePaneState(paneId: string): void {
    const normalizedPaneId = this.normalizePaneId(paneId);
    if (this.paneStore.getPane(normalizedPaneId)) {
      return;
    }

    this.paneStore.addPane({
      paneId: normalizedPaneId,
      tabId: TerminalProvider.DEFAULT_TAB_ID,
      isActive: true,
      size: 100,
    });
    this.dataThrottleService.setFocusedPane(normalizedPaneId);
  }

  private getKnownPaneIds(): string[] {
    const paneIds = Array.from(this.paneStore.getAllPanes().keys());
    return paneIds.length > 0 ? paneIds : [TerminalProvider.DEFAULT_PANE_ID];
  }

  private getFocusedPaneId(): string {
    return this.paneStore.getActivePane()?.paneId ?? TerminalProvider.DEFAULT_PANE_ID;
  }

  private setFocusedPane(paneId: string): void {
    const normalizedPaneId = this.normalizePaneId(paneId);
    if (this.paneStore.getPane(normalizedPaneId)) {
      this.paneStore.setActivePane(normalizedPaneId);
    }
    this.dataThrottleService.setFocusedPane(normalizedPaneId);
  }

  private resolveNextPaneId(): string {
    const nextPaneId = this.paneStore.getActivePane()?.paneId;
    if (nextPaneId) {
      return nextPaneId;
    }

    const firstRemainingPaneId = this.paneStore.getAllPanes().keys().next().value as
      | string
      | undefined;
    if (firstRemainingPaneId) {
      this.paneStore.setActivePane(firstRemainingPaneId);
      return firstRemainingPaneId;
    }

    this.ensureDefaultPaneState();
    return TerminalProvider.DEFAULT_PANE_ID;
  }

  private resolveBackendConfig(
    backend: TerminalBackendType,
    paneId: string = TerminalProvider.DEFAULT_PANE_ID,
  ): BackendPaneConfig | undefined {
    if (this.isEditorPaneId(paneId) && backend !== "tmux") {
      return undefined;
    }
    if (backend === "tmux") {
      const tmuxSessionId = this.sessionRuntime.getSession(TerminalProvider.DEFAULT_PANE_ID)?.tmuxSessionId;
      return tmuxSessionId ? { tmux: { sessionId: tmuxSessionId } } : undefined;
    }
    if (backend === "zellij") {
      const zellijSessionId = this.sessionRuntime.getSession(TerminalProvider.DEFAULT_PANE_ID)?.zellijSessionId;
      return zellijSessionId ? { zellij: { sessionId: zellijSessionId } } : undefined;
    }
    return undefined;
  }

  private isEditorPaneId(paneId: string): boolean {
    return paneId.startsWith(`${TerminalProvider.EDITOR_PANE_PREFIX}-`);
  }

  private isMultiPaneSupportedBackend(): boolean {
    return true;
  }

  private getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  public toggleDashboard(): void {
    void vscode.commands.executeCommand("ulw.openTerminalManager");
  }

  public toggleTmuxCommandToolbar(): void {
    const selectedSessionId = this.sessionRuntime.getSelectedTmuxSessionId();
    const resolvedSessionId =
      this.sessionRuntime.resolveTmuxSessionIdForInstance(
        this.getActiveInstanceId(),
      );
    const tmuxSessionId = selectedSessionId ?? resolvedSessionId;

    this.logger.info(
      `[DIAG:toggleTmuxCommandToolbar] selected=${selectedSessionId ?? "none"} resolved=${resolvedSessionId ?? "none"} effective=${tmuxSessionId ?? "none"} view=${!!this._view} panel=${!!this._panel}`,
    );

    if (!tmuxSessionId) {
      this.logger.warn(
        `[DIAG:toggleTmuxCommandToolbar] BLOCKED — no tmux session id`,
      );
      return;
    }

    this.postWebviewMessage({ type: "toggleTmuxCommandToolbar" });
    this.logger.info(
      `[DIAG:toggleTmuxCommandToolbar] message posted to webview`,
    );
  }

  public dispose(): void {
    this.dataThrottleService.dispose();
    this.paneStore.dispose();
    this.sessionRuntime.dispose();
  }
}
