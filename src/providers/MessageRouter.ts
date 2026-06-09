import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { ContextSharingService } from "../services/ContextSharingService";
import { InstanceId, InstanceStore } from "../services/InstanceStore";
import {
  InputSourceSwitcher,
  type KeyboardInputSourceTarget,
} from "../services/InputSourceSwitcher";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { OutputChannelService } from "../services/OutputChannelService";
import { TerminalManager } from "../terminals/TerminalManager";
import {
  ALLOWED_IMAGE_TYPES,
  DroppedBlobFile,
  MAX_IMAGE_SIZE,
  TMUX_RAW_ALLOWED_SUBCOMMANDS,
  TMUX_WEBVIEW_COMMAND_IDS,
  WebviewMessage,
} from "../types";
import type {
  TerminalBackendType,
  TmuxRawSubcommand,
  TmuxWebviewCommandId,
} from "../types";
import { createSelection, fuzzyMatchFile, openFileInEditor } from "./openFile";

export interface MessageRouterProviderBridge {
  startOpenCode(): Promise<void>;
  switchToTmuxSession(sessionId: string): Promise<void>;
  switchToZellijSession(sessionId: string): Promise<void>;
  killTmuxSession(sessionId: string): Promise<void>;
  createTmuxSession(): Promise<string | undefined>;
  toggleDashboard(): void;
  toggleEditorAttachment(): Promise<void>;
  restart(): void;
  switchToNativeShell(): Promise<void>;
  selectTerminalBackend(backend: TerminalBackendType): Promise<void>;
  cycleTerminalBackend(): Promise<void>;
  pasteText(text: string): void;
  getActiveInstanceId(): InstanceId;
  getActiveTerminalId(): string;
  setLastKnownTerminalSize(cols: number, rows: number): void;
  getLastKnownTerminalSize(): { cols: number; rows: number };
  isStarted(): boolean;
  resizeActiveTerminal(cols: number, rows: number): void;
  postWebviewMessage(message: unknown): void;
  routeDroppedTextToTmuxPane(
    text: string,
    dropCell: { col: number; row: number },
  ): Promise<boolean>;
  formatDroppedFiles(paths: string[], useAtSyntax: boolean): string;
  formatPastedImage(tempPath: string): string | undefined;
  launchAiTool(
    sessionId: string,
    toolName: string,
    savePreference: boolean,
    targetPaneId?: string,
    backendHint?: TerminalBackendType,
  ): Promise<void>;
  executeRawTmuxCommand(subcommand: string, args?: string[]): Promise<string>;
  zoomTmuxPane(): Promise<void>;
  getSelectedTmuxSessionId(): string | undefined;
  isTmuxAvailable(): boolean;
  isZellijAvailable(): boolean;
  getActiveBackend(): TerminalBackendType;
  getBackendAvailability(): {
    native: boolean;
    tmux: boolean;
    zellij: boolean;
  };
  switchPaneBackend(
    paneId: string,
    backend: TerminalBackendType,
  ): Promise<void>;
}

function quoteShellPath(filePath: string): string {
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

function formatDroppedPathsForTerminal(filePaths: string[]): string {
  return filePaths.map((filePath) => quoteShellPath(filePath)).join(" ");
}

export class MessageRouter {
  private static readonly DEFAULT_PANE_ID = "default";

  private readonly lastResizeByPane = new Map<
    string,
    { readonly cols: number; readonly rows: number }
  >();

  public constructor(
    private readonly provider: MessageRouterProviderBridge,
    private readonly context: vscode.ExtensionContext,
    private readonly terminalManager: TerminalManager,
    private readonly captureManager: OutputCaptureManager,
    _apiClient: OpenCodeApiClient | undefined,
    _contextSharingService: ContextSharingService,
    private readonly logger: OutputChannelService,
    _instanceStore: InstanceStore | undefined,
    private readonly inputSourceSwitcher = new InputSourceSwitcher({ logger }),
  ) {}

  public async handleMessage(rawMessage: unknown): Promise<void> {
    if (!rawMessage || typeof rawMessage !== "object") {
      return;
    }

    const message = rawMessage as WebviewMessage;
    const paneId = this.resolvePaneId(message.paneId);
    switch (message.type) {
      case "terminalInput":
        this.handleTerminalInput(message.data, paneId);
        break;
      case "terminalResize":
        this.handleTerminalResize(message.cols, message.rows, paneId);
        break;
      case "switchKeyboardInputSource":
        await this.handleSwitchKeyboardInputSource(message.target, paneId);
        break;
      case "ready":
        this.handleReady(message.cols, message.rows, paneId);
        break;
      case "filesDropped":
        await this.handleFilesDropped(
          message.files ?? [],
          message.shiftKey ?? false,
          message.dropCell,
          message.blobFiles,
          paneId,
        );
        break;
      case "openUrl":
        if (typeof message.url === "string") {
          void vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
      case "openFile":
        if (typeof message.path === "string") {
          void this.handleOpenFile(
            message.path,
            message.line,
            message.endLine,
            message.column,
          );
        }
        break;
      case "listTerminals":
        void this.handleListTerminals();
        break;
      case "setClipboard":
        if (typeof message.text === "string") {
          void this.handleSetClipboard(message.text);
        }
        break;
      case "triggerPaste":
        void this.handlePaste();
        break;
      case "imagePasted":
        if (typeof message.data === "string") {
          void this.handleImagePasted(message.data);
        }
        break;
      case "switchSession":
        if (typeof message.sessionId === "string") {
          if (this.provider.getActiveBackend() === "zellij") {
            void this.provider.switchToZellijSession(message.sessionId);
          } else {
            void this.provider.switchToTmuxSession(message.sessionId);
          }
        }
        break;
      case "killSession":
        if (typeof message.sessionId === "string") {
          void this.provider.killTmuxSession(message.sessionId);
        }
        break;
      case "createTmuxSession":
        if (this.provider.getActiveBackend() === "zellij") {
          void this.provider.selectTerminalBackend("zellij");
        } else {
          void this.provider.createTmuxSession();
        }
        break;
      case "launchAiTool": {
        const backendHint = this.provider.getActiveBackend();
        void this.provider.launchAiTool(
          message.sessionId,
          message.tool,
          message.savePreference,
          message.targetPaneId,
          backendHint,
        );
        break;
      }
      case "zoomTmuxPane":
        try {
          await this.provider.zoomTmuxPane();
        } catch (error) {
          this.logger.error(
            `[MessageRouter] zoomTmuxPane failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        break;
      case "sendTmuxPromptChoice":
        if (message.choice === "tmux") {
          void this.provider.selectTerminalBackend("tmux");
        } else if (message.choice === "shell") {
          void this.provider.switchToNativeShell();
        } else if (message.choice === "zellij") {
          void this.provider.selectTerminalBackend("zellij");
        }
        break;
      case "selectTerminalBackend":
        void this.provider.selectTerminalBackend(message.backend);
        break;
      case "cycleTerminalBackend":
        void this.provider.cycleTerminalBackend();
        break;
      case "paneSwitchBackend":
        void this.provider.switchPaneBackend(message.paneId, message.backend);
        break;
      case "executeTmuxCommand":
        await this.handleExecuteTmuxCommand(message.commandId);
        break;
      case "executeTmuxRawCommand":
        await this.handleExecuteTmuxRawCommand(
          message.subcommand,
          message.args,
        );
        break;
      case "toggleDashboard":
        this.provider.toggleDashboard();
        break;
      case "toggleEditorAttachment":
        await this.provider.toggleEditorAttachment();
        break;
      case "requestRestart":
        this.provider.restart();
        break;
      default:
        break;
    }
  }

  public handleTerminalInput(
    data: string | undefined,
    paneId: string = MessageRouter.DEFAULT_PANE_ID,
  ): void {
    if (typeof data !== "string") {
      return;
    }

    this.terminalManager.writeToTerminal(
      this.resolveTerminalTarget(paneId),
      data,
    );
  }

  public async handleSwitchKeyboardInputSource(
    target: KeyboardInputSourceTarget,
    paneId: string = MessageRouter.DEFAULT_PANE_ID,
  ): Promise<void> {
    await this.inputSourceSwitcher.switchTo(target);
    this.provider.postWebviewMessage({
      type: "focusTerminal",
      paneId,
    });
  }

  private async handleExecuteTmuxCommand(commandId: unknown): Promise<void> {
    if (!this.isTmuxWebviewCommandId(commandId)) {
      return;
    }

    try {
      await vscode.commands.executeCommand(commandId);
    } catch (error) {
      this.logger.error(
        `[MessageRouter] executeTmuxCommand failed for ${commandId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleExecuteTmuxRawCommand(
    subcommand: unknown,
    args: unknown,
  ): Promise<void> {
    if (!this.isTmuxRawSubcommand(subcommand)) {
      return;
    }

    if (args !== undefined && !this.isStringArray(args)) {
      return;
    }

    try {
      if (this.provider.getActiveBackend() === "zellij") {
        this.logger.warn(
          `[MessageRouter] executeTmuxRawCommand ignored for zellij backend: ${subcommand}`,
        );
        return;
      }

      await this.provider.executeRawTmuxCommand(subcommand, args);
    } catch (error) {
      this.logger.error(
        `[MessageRouter] executeTmuxRawCommand failed for ${subcommand}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private isTmuxWebviewCommandId(
    value: unknown,
  ): value is TmuxWebviewCommandId {
    return (
      typeof value === "string" &&
      TMUX_WEBVIEW_COMMAND_IDS.some((commandId) => commandId === value)
    );
  }

  private isTmuxRawSubcommand(value: unknown): value is TmuxRawSubcommand {
    return (
      typeof value === "string" &&
      TMUX_RAW_ALLOWED_SUBCOMMANDS.some((command) => command === value)
    );
  }

  private isStringArray(value: unknown): value is string[] {
    return (
      Array.isArray(value) && value.every((item) => typeof item === "string")
    );
  }

  public handleTerminalResize(
    cols: number | undefined,
    rows: number | undefined,
    paneId: string = MessageRouter.DEFAULT_PANE_ID,
  ): void {
    if (typeof cols !== "number" || typeof rows !== "number") {
      return;
    }

    const previousSize = this.lastResizeByPane.get(paneId);
    if (previousSize?.cols === cols && previousSize.rows === rows) {
      return;
    }
    this.lastResizeByPane.set(paneId, { cols, rows });

    this.provider.setLastKnownTerminalSize(cols, rows);
    this.terminalManager.resizeTerminal(
      this.resolveTerminalTarget(paneId),
      cols,
      rows,
    );
  }

  public handleReady(
    cols: number | undefined,
    rows: number | undefined,
    _paneId: string = MessageRouter.DEFAULT_PANE_ID,
  ): void {
    if (typeof cols === "number" && typeof rows === "number") {
      this.provider.setLastKnownTerminalSize(cols, rows);
    }

    if (!this.provider.isStarted()) {
      void this.provider.startOpenCode();
    } else {
      const size = this.provider.getLastKnownTerminalSize();
      if (size.cols && size.rows) {
        this.provider.resizeActiveTerminal(size.cols, size.rows);
      }
    }

    this.provider.postWebviewMessage({
      type: "platformInfo",
      platform: process.platform,
      tmuxAvailable: this.provider.isTmuxAvailable(),
      zellijAvailable: this.provider.isZellijAvailable(),
      backendAvailability: this.provider.getBackendAvailability(),
      activeBackend: this.provider.getActiveBackend(),
    });
  }

  public async handleOpenFile(
    filePath: string,
    line?: number,
    endLine?: number,
    column?: number,
  ): Promise<void> {
    await openFileInEditor(filePath, line, endLine, column, (message) => {
      this.logger.error(message);
    });
  }

  public async handleFilesDropped(
    files: string[],
    shiftKey: boolean,
    dropCell?: { col: number; row: number },
    blobFiles?: DroppedBlobFile[],
    paneId: string = MessageRouter.DEFAULT_PANE_ID,
  ): Promise<void> {
    this.logger.info(
      `[PROVIDER] handleFilesDropped - files: ${JSON.stringify(files)} shiftKey: ${shiftKey} dropCell: ${JSON.stringify(dropCell)}`,
    );

    const normalizedFiles = files.map((file) => {
      if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(file)) {
        try {
          return vscode.Uri.parse(file).fsPath;
        } catch {
          // intentionally empty: fall through to raw file path on URI parse failure
        }
      }
      return file;
    });

    let dedupedFiles = [
      ...new Set(normalizedFiles.map((p) => path.normalize(p))),
    ];

    if (dedupedFiles.length === 0 && blobFiles && blobFiles.length > 0) {
      const resolvedBlobPaths =
        await this.resolveDroppedBlobFilePaths(blobFiles);
      const materializedBlobPaths =
        resolvedBlobPaths.length > 0
          ? resolvedBlobPaths
          : await this.materializeDroppedBlobFiles(blobFiles);
      dedupedFiles = [
        ...new Set(materializedBlobPaths.map((p) => path.normalize(p))),
      ];
    }

    if (dedupedFiles.length === 0) {
      this.logger.warn("[PROVIDER] No usable dropped file paths were resolved");
      return;
    }

    const relativeFiles = dedupedFiles.map((file) =>
      vscode.workspace.asRelativePath(file),
    );
    const droppedText = formatDroppedPathsForTerminal(relativeFiles);

    if (shiftKey) {
      this.logger.info(`[PROVIDER] Writing dropped files: ${droppedText}`);

      if (dropCell) {
        void this.provider
          .routeDroppedTextToTmuxPane(droppedText + " ", dropCell)
          .then((routed) => {
            if (!routed) {
              this.logger.info(
                `[PROVIDER] Pane routing failed, falling back to active terminal`,
              );
              this.terminalManager.writeToTerminal(
                this.resolveTerminalTarget(paneId),
                droppedText + " ",
              );
            }
          });
      } else {
        this.terminalManager.writeToTerminal(
          this.resolveTerminalTarget(paneId),
          droppedText + " ",
        );
      }
    } else {
      this.logger.info(`[PROVIDER] Writing dropped files: ${droppedText}`);
      this.terminalManager.writeToTerminal(
        this.resolveTerminalTarget(paneId),
        droppedText + " ",
      );
    }
  }

  private resolvePaneId(paneId: string | undefined): string {
    return paneId ?? MessageRouter.DEFAULT_PANE_ID;
  }

  private resolveTerminalTarget(paneId: string): string {
    return paneId === MessageRouter.DEFAULT_PANE_ID
      ? this.provider.getActiveTerminalId()
      : paneId;
  }

  public async handlePaste(): Promise<void> {
    try {
      const text = await vscode.env.clipboard.readText();
      if (text) {
        this.provider.pasteText(text);
      }
    } catch (error) {
      this.logger.error(
        `[TerminalProvider] Failed to paste: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async handleSetClipboard(text: string): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(text);
    } catch (error) {
      this.logger.error(
        `[TerminalProvider] Failed to write clipboard: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async handleImagePasted(data: string): Promise<void> {
    try {
      const parsedDataUrl = this.parseDataUrl(data);
      if (!parsedDataUrl) {
        this.logger.error("[TerminalProvider] Invalid image data URL format");
        return;
      }

      const { mimeType, buffer } = parsedDataUrl;
      if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
        this.logger.error(
          `[TerminalProvider] Unsupported image type: ${mimeType}`,
        );
        return;
      }

      if (buffer.length > MAX_IMAGE_SIZE) {
        this.logger.error("[TerminalProvider] Image exceeds 10MB size limit");
        return;
      }

      const extension = mimeType.split("/")[1];
      const tmpPath = await this.writeSecureTempFile(
        `opencode-clipboard-${randomUUID()}.${extension}`,
        buffer,
      );

      const formattedImage = this.provider.formatPastedImage(tmpPath);
      if (formattedImage) {
        this.provider.pasteText(formattedImage);
      }

      this.scheduleTempFileCleanup(tmpPath);
    } catch (error) {
      this.logger.error(
        `[TerminalProvider] Failed to handle pasted image: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private parseDataUrl(
    data: string,
  ): { mimeType: string; buffer: Buffer } | undefined {
    const base64Match = data.match(
      /^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/,
    );
    if (!base64Match) {
      return undefined;
    }

    return {
      mimeType: base64Match[1],
      buffer: Buffer.from(base64Match[2], "base64"),
    };
  }

  private sanitizeDroppedBlobFileName(name: string): string {
    const baseName = name.split(/[\\/]/).pop()?.trim() || "dropped-file";
    const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return sanitized.length > 0 ? sanitized : "dropped-file";
  }

  private async writeSecureTempFile(
    fileName: string,
    buffer: Buffer,
  ): Promise<string> {
    const tmpPath = path.join(os.tmpdir(), fileName);
    await fs.promises.writeFile(tmpPath, buffer, {
      flag: "wx",
      mode: 0o600,
    });
    return tmpPath;
  }

  private scheduleTempFileCleanup(tmpPath: string): void {
    setTimeout(
      async () => {
        try {
          await fs.promises.unlink(tmpPath);
          this.logger.debug(
            `[TerminalProvider] Cleaned up temp file: ${tmpPath}`,
          );
        } catch (err) {
          this.logger.warn(
            `[TerminalProvider] Failed to cleanup temp file: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
      5 * 60 * 1000,
    );
  }

  private async materializeDroppedBlobFiles(
    blobFiles: DroppedBlobFile[],
  ): Promise<string[]> {
    const materializedPaths: string[] = [];

    for (const blobFile of blobFiles) {
      try {
        const parsedDataUrl = this.parseDataUrl(blobFile.data);
        if (!parsedDataUrl) {
          this.logger.error(
            `[TerminalProvider] Invalid dropped blob data URL for ${blobFile.name}`,
          );
          continue;
        }

        if (parsedDataUrl.buffer.length > MAX_IMAGE_SIZE) {
          this.logger.error(
            `[TerminalProvider] Dropped file exceeds 10MB size limit: ${blobFile.name}`,
          );
          continue;
        }

        const safeName = this.sanitizeDroppedBlobFileName(blobFile.name);
        const tmpPath = await this.writeSecureTempFile(
          `opencode-drop-${randomUUID()}-${safeName}`,
          parsedDataUrl.buffer,
        );
        this.scheduleTempFileCleanup(tmpPath);
        materializedPaths.push(tmpPath);
      } catch (error) {
        this.logger.error(
          `[TerminalProvider] Failed to materialize dropped blob ${blobFile.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return materializedPaths;
  }

  private async resolveDroppedBlobFilePaths(
    blobFiles: DroppedBlobFile[],
  ): Promise<string[]> {
    const resolvedPaths: string[] = [];

    for (const blobFile of blobFiles) {
      const fileName = blobFile.name.split(/[\\/]/).pop()?.trim();
      if (!fileName) {
        continue;
      }
      const matches = await vscode.workspace.findFiles(
        `**/${fileName}`,
        null,
        2,
      );

      if (matches.length === 1) {
        resolvedPaths.push(matches[0].fsPath);
      }
    }

    return resolvedPaths.length === blobFiles.length ? resolvedPaths : [];
  }

  public async handleListTerminals(): Promise<void> {
    const terminals = await this.getTerminalEntries();
    this.provider.postWebviewMessage({
      type: "terminalList",
      terminals,
    });
  }

  public async sendCommandToTerminal(
    terminal: vscode.Terminal,
    command: string,
  ): Promise<void> {
    const configKey = "ulw.allowTerminalCommands";
    const allowed = this.context.globalState.get<boolean>(configKey);

    if (allowed) {
      terminal.sendText(command);
      return;
    }

    const result = await vscode.window.showInformationMessage(
      "Allow OpenCode to send commands to external terminals?",
      "Yes",
      "Yes, don't ask again",
      "No",
    );

    if (result === "Yes") {
      terminal.sendText(command);
      return;
    }

    if (result === "Yes, don't ask again") {
      await this.context.globalState.update(configKey, true);
      terminal.sendText(command);
    }
  }

  public startTerminalCapture(
    terminal: vscode.Terminal,
    terminalName: string,
  ): void {
    const result = this.captureManager.startCapture(terminal);
    if (result.success) {
      void vscode.window.showInformationMessage(
        `Started capturing terminal: ${terminalName}`,
      );
      return;
    }

    void vscode.window.showErrorMessage(
      `Failed to start capture: ${result.error ?? "Unknown error"}`,
    );
  }

  public async getTerminalEntries(): Promise<
    Array<{ name: string; cwd: string }>
  > {
    const entries: Array<{ name: string; cwd: string }> = [];

    for (const terminal of vscode.window.terminals) {
      if (terminal.name === "ULW Terminal") {
        continue;
      }

      let cwd = "";
      try {
        cwd = terminal.shellIntegration?.cwd?.fsPath ?? "";
      } catch {
        cwd = "";
      }

      entries.push({
        name: terminal.name,
        cwd,
      });
    }

    return entries;
  }

  public createSelection(
    line?: number,
    endLine?: number,
    column?: number,
  ): vscode.Range | undefined {
    return createSelection(line, endLine, column);
  }

  public async fuzzyMatchFile(filePath: string): Promise<vscode.Uri | null> {
    return fuzzyMatchFile(filePath, (message) => {
      this.logger.error(message);
    });
  }
}
