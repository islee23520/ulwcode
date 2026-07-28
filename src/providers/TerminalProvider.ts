import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import type { CursorStyle, HostMessage, TerminalConfig, WebviewMessage } from "../types";
import { TerminalManager } from "../terminals/TerminalManager";
import { renderTerminalHtml } from "../webview/terminal/html";

const TERMINAL_ID = "sidebar-shell";
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export class TerminalProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "ulw";

  private view: vscode.WebviewView | undefined;
  private editorPanel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly terminalManager: TerminalManager,
  ) {
    this.disposables.push(
      terminalManager.onData(({ id, data }) => {
        if (id === TERMINAL_ID) {
          this.postMessage({ type: "output", data });
        }
      }),
      terminalManager.onExit(({ id, code, signal }) => {
        if (id === TERMINAL_ID) {
          this.postMessage({ type: "exit", code, signal });
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("ulw")) {
          this.postMessage({ type: "config", ...this.readConfig() });
        }
      }),
    );
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"),
    );
    webview.html = renderTerminalHtml({
      cspSource: webview.cspSource,
      nonce: this.createNonce(),
      scriptUri: scriptUri.toString(),
    });

    this.disposables.push(
      webview.onDidReceiveMessage((message: WebviewMessage) => {
        this.handleMessage(message);
      }),
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) {
          this.view = undefined;
        }
      }),
    );
  }

  public toggleEditorLocation(): void {
    if (this.editorPanel) {
      this.editorPanel.dispose();
      this.editorPanel = undefined;
      this.postMessage({ type: "focus" });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "ulw.terminalEditor",
      "ULW Terminal",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.editorPanel = panel;
    panel.webview.html = this.view?.webview.html ?? "";
    panel.onDidDispose(() => {
      this.editorPanel = undefined;
    });
  }

  public write(data: string): void {
    this.terminalManager.write(TERMINAL_ID, data);
  }

  public isRunning(): boolean {
    return this.terminalManager.hasTerminal(TERMINAL_ID);
  }

  public terminalCount(): number {
    return this.terminalManager.terminalCount();
  }

  public dispose(): void {
    this.terminalManager.kill(TERMINAL_ID);
    this.editorPanel?.dispose();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.view = undefined;
    this.editorPanel = undefined;
  }

  private handleMessage(message: WebviewMessage): void {
    switch (message.type) {
      case "ready":
        if (!this.terminalManager.hasTerminal(TERMINAL_ID)) {
          this.terminalManager.createTerminal(TERMINAL_ID, message.cols, message.rows);
        } else {
          this.terminalManager.resize(TERMINAL_ID, message.cols, message.rows);
        }
        this.postMessage({ type: "config", ...this.readConfig() });
        this.postMessage({ type: "focus" });
        break;
      case "input":
        this.terminalManager.write(TERMINAL_ID, message.data);
        break;
      case "resize":
        this.terminalManager.resize(TERMINAL_ID, message.cols, message.rows);
        break;
      case "copy":
        if (message.text) {
          void vscode.env.clipboard.writeText(message.text);
        }
        break;
      case "imagePasted":
        void this.saveImageAndPostPath(message.data);
        break;
    }
  }

  private postMessage(message: HostMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private async saveImageAndPostPath(dataUrl: string): Promise<void> {
    const parsed = this.parseDataUrl(dataUrl);
    if (!parsed) {
      return;
    }

    const { mimeType, buffer } = parsed;
    if (!ALLOWED_IMAGE_TYPES.includes(mimeType as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      return;
    }
    if (buffer.length > MAX_IMAGE_SIZE) {
      return;
    }

    const extension = mimeType.split("/")[1];
    const tmpPath = path.join(
      os.tmpdir(),
      `ulw-clipboard-${randomUUID()}.${extension}`,
    );
    await fs.promises.writeFile(tmpPath, buffer, { mode: 0o600 });
    this.postMessage({ type: "clipboardImage", filePath: tmpPath });
  }

  private parseDataUrl(
    data: string,
  ): { mimeType: string; buffer: Buffer } | undefined {
    const match = data.match(
      /^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/,
    );
    if (!match) {
      return undefined;
    }
    return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
  }

  private readConfig(): TerminalConfig {
    const configuration = vscode.workspace.getConfiguration("ulw");
    return {
      fontSize: configuration.get<number>("fontSize", 14),
      fontFamily: configuration.get<string>(
        "fontFamily",
        "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', Menlo, monospace",
      ),
      cursorBlink: configuration.get<boolean>("cursorBlink", true),
      cursorStyle: configuration.get<CursorStyle>("cursorStyle", "block"),
      scrollback: configuration.get<number>("scrollback", 10000),
    };
  }

  private createNonce(): string {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: 32 }, () =>
      alphabet.charAt(Math.floor(Math.random() * alphabet.length)),
    ).join("");
  }
}
