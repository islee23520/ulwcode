import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "../test/mocks/vscode";
import { CodexIdeContextService } from "./CodexIdeContextService";

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

type IpcMessage = Record<string, unknown>;

describe("CodexIdeContextService", () => {
  let service: CodexIdeContextService | undefined;
  let routerServer: net.Server | undefined;
  let tempDir: string;
  let socketPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-ide-context-"));
    socketPath = path.join(tempDir, "ipc.sock");
    vscode.window.activeTextEditor = undefined;
    vscode.window.visibleTextEditors = [];
    vi.mocked(vscode.workspace.asRelativePath).mockImplementation(
      (uri: { fsPath?: string; path?: string }) => uri.path ?? uri.fsPath ?? "",
    );
  });

  afterEach(() => {
    service?.dispose();
    service = undefined;
    routerServer?.close();
    routerServer = undefined;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("builds Codex IDE context from the active editor and visible tabs", () => {
    const activeDocument = new vscode.TextDocument(
      vscode.Uri.file("/repo/src/lib.ts"),
      "const selected = true;\n",
    );
    activeDocument.getText = vi.fn(() => "selected");
    const activeEditor = new vscode.TextEditor(
      activeDocument,
      new vscode.Selection(0, 6, 0, 14),
    );
    const tabDocument = new vscode.TextDocument(
      vscode.Uri.file("/repo/src/other.ts"),
      "",
    );
    const tabEditor = new vscode.TextEditor(
      tabDocument,
      new vscode.Selection(0, 0, 0, 0),
    );
    vscode.window.activeTextEditor = activeEditor;
    vscode.window.visibleTextEditors = [activeEditor, tabEditor];
    vi.mocked(vscode.workspace.asRelativePath).mockImplementation(
      (uri: { fsPath?: string }) =>
        uri.fsPath?.replace("/repo/", "") ?? "",
    );
    service = new CodexIdeContextService(undefined, { socketPath });

    expect(service.buildIdeContext()).toEqual({
      activeFile: {
        label: "lib.ts",
        path: "src/lib.ts",
        selection: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 14 },
        },
        activeSelectionContent: "selected",
        selections: [
          {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 14 },
          },
        ],
      },
      openTabs: [
        { label: "lib.ts", path: "src/lib.ts" },
        { label: "other.ts", path: "src/other.ts" },
      ],
    });
  });

  it("responds to Codex ide-context socket requests", async () => {
    const activeDocument = new vscode.TextDocument(
      vscode.Uri.file("/repo/src/lib.ts"),
      "hello",
    );
    const activeEditor = new vscode.TextEditor(
      activeDocument,
      new vscode.Selection(0, 0, 0, 0),
    );
    vscode.window.activeTextEditor = activeEditor;
    vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/lib.ts");
    service = new CodexIdeContextService(undefined, { socketPath });
    await service.start();

    const socket = await connectSocket(socketPath);
    writeFrame(socket, {
      type: "request",
      requestId: "request-1",
      sourceClientId: "codex-tui",
      version: 0,
      method: "ide-context",
      params: { workspaceRoot: "/repo" },
    });

    await expect(readFrame(socket)).resolves.toMatchObject({
      type: "response",
      requestId: "request-1",
      resultType: "success",
      method: "ide-context",
      handledByClientId: "open-sidebar-tui",
      result: {
        ideContext: {
          activeFile: {
            label: "lib.ts",
            path: "src/lib.ts",
          },
        },
      },
    });
    socket.destroy();
  });

  it("registers with an existing Codex IPC router and serves IDE context requests", async () => {
    const activeDocument = new vscode.TextDocument(
      vscode.Uri.file("/repo/src/router.ts"),
      "router",
    );
    vscode.window.activeTextEditor = new vscode.TextEditor(
      activeDocument,
      new vscode.Selection(0, 0, 0, 0),
    );
    vi.mocked(vscode.workspace.asRelativePath).mockReturnValue("src/router.ts");

    const routerSockets: net.Socket[] = [];
    const routerClientSocket = new Promise<net.Socket>((resolve) => {
      routerServer = net.createServer((socket) => {
        routerSockets.push(socket);
        if (routerSockets.length === 2) {
          resolve(socket);
        }
      });
    });
    await listenServer(routerServer, socketPath);

    service = new CodexIdeContextService(undefined, { socketPath });
    await service.start();
    const socket = await routerClientSocket;

    writeFrame(socket, {
      type: "client-discovery-request",
      requestId: "discovery-1",
      request: {
        type: "request",
        requestId: "request-1",
        sourceClientId: "codex-tui",
        version: 0,
        method: "ide-context",
        params: { workspaceRoot: "/repo" },
      },
    });

    await expect(readFrame(socket)).resolves.toMatchObject({
      type: "client-discovery-response",
      requestId: "discovery-1",
      response: { canHandle: true },
    });

    writeFrame(socket, {
      type: "request",
      requestId: "request-1",
      sourceClientId: "codex-tui",
      version: 0,
      method: "ide-context",
      params: { workspaceRoot: "/repo" },
    });

    await expect(readFrame(socket)).resolves.toMatchObject({
      type: "response",
      requestId: "request-1",
      resultType: "success",
      method: "ide-context",
      handledByClientId: "open-sidebar-tui",
      result: {
        type: "broadcast",
        ideContext: {
          activeFile: {
            label: "router.ts",
            path: "src/router.ts",
          },
        },
      },
    });
  });
});

function writeFrame(socket: net.Socket, message: IpcMessage): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  socket.write(Buffer.concat([header, payload]));
}

async function readFrame(socket: net.Socket): Promise<IpcMessage> {
  return new Promise((resolve, reject) => {
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) {
        return;
      }
      const length = buffer.readUInt32LE(0);
      if (buffer.length >= 4 + length) {
        socket.off("data", onData);
        const payload = buffer.subarray(4, 4 + length);
        const parsed: unknown = JSON.parse(payload.toString("utf8"));
        if (isIpcMessage(parsed)) {
          resolve(parsed);
          return;
        }
        reject(new Error("received non-object IPC message"));
      }
    };
    socket.on("data", onData);
  });
}

function connectSocket(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => resolve(socket));
    socket.once("error", reject);
  });
}

function listenServer(
  server: net.Server | undefined,
  socketPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      reject(new Error("router server was not created"));
      return;
    }
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function isIpcMessage(value: unknown): value is IpcMessage {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
