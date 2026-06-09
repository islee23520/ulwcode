import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ILogger } from "./ILogger";
import {
  drainCodexIpcFrames,
  objectValue,
  parseCodexIpcMessage,
  stringValue,
  writeCodexIpcFrame,
  type CodexActiveFile,
  type CodexFileDescriptor,
  type CodexIdeContext,
  type CodexIdeContextServiceOptions,
  type CodexIpcMessage,
  type CodexRange,
} from "./CodexIdeContextProtocol";

export class CodexIdeContextService implements vscode.Disposable {
  private client: net.Socket | undefined;
  private server: net.Server | undefined;
  private readonly socketPath: string;
  private ownsSocket = false;

  public constructor(
    private readonly logger?: ILogger,
    options: CodexIdeContextServiceOptions = {},
  ) {
    this.socketPath = options.socketPath ?? this.defaultSocketPath();
  }

  public async start(): Promise<void> {
    if (process.platform === "win32") {
      return;
    }

    const socketState = await this.prepareSocketPath();
    if (socketState === "active") {
      this.client = await this.connectToRouter();
      this.logger?.info(
        `[CodexIdeContextService] Connected to Codex IPC router at ${this.socketPath}`,
      );
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => this.handleConnection(socket));
      this.server = server;
      server.once("error", reject);
      server.listen(this.socketPath, () => {
        server.off("error", reject);
        this.ownsSocket = true;
        this.logger?.info(
          `[CodexIdeContextService] Listening for Codex IDE context at ${this.socketPath}`,
        );
        resolve();
      });
    });
  }

  public dispose(): void {
    const socketPath = this.socketPath;
    const shouldUnlink = this.ownsSocket;
    this.ownsSocket = false;
    this.client?.destroy();
    this.client = undefined;
    this.server?.close(() => {
      if (shouldUnlink) {
        this.unlinkIfExists(socketPath);
      }
    });
    this.server = undefined;
  }

  public buildIdeContext(): CodexIdeContext {
    return {
      activeFile: this.buildActiveFile(),
      openTabs: this.buildOpenTabs(),
    };
  }

  private async prepareSocketPath(): Promise<"active" | "available"> {
    const parent = path.dirname(this.socketPath);
    fs.mkdirSync(parent, { mode: 0o700, recursive: true });
    fs.chmodSync(parent, 0o700);

    if (!fs.existsSync(this.socketPath)) {
      return "available";
    }

    if (await this.canConnect(this.socketPath)) {
      return "active";
    }

    this.unlinkIfExists(this.socketPath);
    return "available";
  }

  private connectToRouter(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      socket.once("connect", () => {
        this.handleConnection(socket);
        socket.off("error", reject);
        socket.on("error", (error) => {
          this.logger?.warn(
            `[CodexIdeContextService] Codex IPC router error: ${error.message}`,
          );
        });
        resolve(socket);
      });
      socket.once("error", reject);
    });
  }

  private canConnect(socketPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection(socketPath);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  private handleConnection(socket: net.Socket): void {
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      buffer = drainCodexIpcFrames(buffer, (payload) => {
        this.handleMessage(socket, payload);
      });
    });
    socket.on("error", (error) => {
      this.logger?.warn(
        `[CodexIdeContextService] IDE context socket error: ${error.message}`,
      );
    });
  }

  private handleMessage(socket: net.Socket, payload: Buffer): void {
    const message = parseCodexIpcMessage(payload, this.logger);
    if (!message) {
      return;
    }

    if (message.type === "client-discovery-request") {
      this.handleClientDiscoveryRequest(socket, message);
      return;
    }

    const requestId = stringValue(message.requestId);
    if (!requestId) {
      return;
    }

    if (message.type === "request" && message.method === "ide-context") {
      this.writeIdeContextResponse(socket, requestId);
      return;
    }

    writeCodexIpcFrame(socket, {
      type: "response",
      requestId,
      resultType: "error",
      error: "no-handler-for-request",
    });
  }

  private handleClientDiscoveryRequest(
    socket: net.Socket,
    message: CodexIpcMessage,
  ): void {
    const requestId = stringValue(message.requestId);
    if (!requestId) {
      return;
    }

    const request = objectValue(message.request);
    writeCodexIpcFrame(socket, {
      type: "client-discovery-response",
      requestId,
      response: {
        canHandle: request?.method === "ide-context",
      },
    });
  }

  private writeIdeContextResponse(socket: net.Socket, requestId: string): void {
    writeCodexIpcFrame(socket, {
      type: "response",
      requestId,
      resultType: "success",
      method: "ide-context",
      handledByClientId: "open-sidebar-tui",
      result: {
        type: "broadcast",
        ideContext: this.buildIdeContext(),
      },
    });
  }

  private buildActiveFile(): CodexActiveFile | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    return {
      ...this.fileDescriptor(editor.document.uri),
      selection: this.range(editor.selection),
      activeSelectionContent: editor.selection.isEmpty
        ? ""
        : editor.document.getText(editor.selection),
      selections: editor.selections.map((selection) => this.range(selection)),
    };
  }

  private buildOpenTabs(): readonly CodexFileDescriptor[] {
    const descriptors = new Map<string, CodexFileDescriptor>();
    for (const editor of vscode.window.visibleTextEditors) {
      const descriptor = this.fileDescriptor(editor.document.uri);
      descriptors.set(editor.document.uri.fsPath, descriptor);
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const descriptor = this.fileDescriptor(activeEditor.document.uri);
      descriptors.set(activeEditor.document.uri.fsPath, descriptor);
    }

    return [...descriptors.values()];
  }

  private fileDescriptor(uri: vscode.Uri): CodexFileDescriptor {
    return {
      label: path.basename(uri.fsPath),
      path: vscode.workspace.asRelativePath(uri, false),
    };
  }

  private range(range: vscode.Range): CodexRange {
    return {
      start: {
        line: range.start.line,
        character: range.start.character,
      },
      end: {
        line: range.end.line,
        character: range.end.character,
      },
    };
  }

  private defaultSocketPath(): string {
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    return path.join(os.tmpdir(), "codex-ipc", `ipc-${uid}.sock`);
  }

  private unlinkIfExists(socketPath: string): void {
    try {
      fs.unlinkSync(socketPath);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        this.logger?.warn(
          `[CodexIdeContextService] Failed to remove socket ${socketPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
