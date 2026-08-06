import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomBytes, randomUUID } from "crypto";
import * as vscode from "vscode";
import type { CursorStyle, HostMessage, TerminalConfig, WebviewMessage } from "../types";
import { TerminalManager } from "../terminals/TerminalManager";
import { renderTerminalHtml } from "../webview/terminal/html";

const TERMINAL_ID = "sidebar-shell";
const EDITOR_VIEW_TYPE = "ulw.terminalEditor";
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_SCROLLBACK_CHARS = 500_000;

export type TerminalLocation = "sidebar" | "editor";

export class TerminalProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "ulw";

  private view: vscode.WebviewView | undefined;
  private editorPanel: vscode.WebviewPanel | undefined;
  private activeLocation: TerminalLocation = "sidebar";
  private disposing = false;
  private scrollback = "";
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly terminalManager: TerminalManager,
  ) {
    this.disposables.push(
      terminalManager.onData(({ id, data }) => {
        if (id !== TERMINAL_ID) {
          return;
        }
        this.appendScrollback(data);
        this.postMessage({ type: "output", data });
      }),
      terminalManager.onExit(({ id, code, signal }) => {
        if (id !== TERMINAL_ID) {
          return;
        }
        this.scrollback = "";
        this.postMessage({ type: "exit", code, signal });
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
    this.configureWebview(webviewView.webview);
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
        this.handleMessage(message, "sidebar");
      }),
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) {
          this.view = undefined;
        }
      }),
    );
    webviewView.webview.html = this.renderHtml(webviewView.webview);
  }

  public openAtConfiguredLocation(): void {
    if (this.readDefaultLocation() === "editor") {
      this.openEditorPanel();
    }
  }

  public toggleEditorLocation(): void {
    if (this.editorPanel) {
      this.closeEditorPanel();
      return;
    }
    this.openEditorPanel();
  }

  public isEditorLocation(): boolean {
    return this.activeLocation === "editor" && this.editorPanel !== undefined;
  }

  public getDefaultLocation(): TerminalLocation {
    return this.readDefaultLocation();
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
    this.disposing = true;
    this.terminalManager.kill(TERMINAL_ID);
    const panel = this.editorPanel;
    this.editorPanel = undefined;
    panel?.dispose();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.view = undefined;
    this.activeLocation = "sidebar";
    this.scrollback = "";
    this.disposing = false;
  }

  private openEditorPanel(): void {
    if (this.editorPanel) {
      this.activeLocation = "editor";
      this.editorPanel.reveal(vscode.ViewColumn.Beside);
      this.postMessage({ type: "focus" });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      EDITOR_VIEW_TYPE,
      "ULW Terminal",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    );
    this.editorPanel = panel;
    this.activeLocation = "editor";
    this.configureWebview(panel.webview);
    const messageSubscription = panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        this.handleMessage(message, "editor");
      },
    );
    const disposeSubscription = panel.onDidDispose(() => {
      messageSubscription.dispose();
      disposeSubscription.dispose();
      if (this.editorPanel === panel && !this.disposing) {
        this.editorPanel = undefined;
        this.activeLocation = "sidebar";
        this.postMessage({ type: "focus" });
        void vscode.commands.executeCommand("workbench.view.extension.ulwContainer");
      }
    });
    panel.webview.html = this.renderHtml(panel.webview);
    void vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
  }

  private closeEditorPanel(): void {
    const panel = this.editorPanel;
    if (!panel) {
      return;
    }
    this.editorPanel = undefined;
    this.activeLocation = "sidebar";
    panel.dispose();
    if (!this.disposing) {
      this.postMessage({ type: "focus" });
      void vscode.commands.executeCommand("workbench.view.extension.ulwContainer");
    }
  }

  private handleMessage(message: WebviewMessage, source: TerminalLocation): void {
    switch (message.type) {
      case "ready": {
        const isActive = source === this.activeLocation;
        if (isActive) {
          if (!this.terminalManager.hasTerminal(TERMINAL_ID)) {
            this.terminalManager.createTerminal(TERMINAL_ID, message.cols, message.rows);
          } else {
            this.terminalManager.resize(TERMINAL_ID, message.cols, message.rows);
          }
        }
        this.postToSurface(source, { type: "config", ...this.readConfig() });
        this.replayScrollback(source);
        if (isActive) {
          this.postMessage({ type: "focus" });
        }
        break;
      }
      case "input":
        if (source !== this.activeLocation) {
          return;
        }
        this.terminalManager.write(TERMINAL_ID, message.data);
        break;
      case "resize":
        if (source !== this.activeLocation) {
          return;
        }
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
      default: {
        const _exhaustive: never = message;
        void _exhaustive;
      }
    }
  }

  private postMessage(message: HostMessage): void {
    if (message.type === "focus") {
      if (this.activeLocation === "editor" && this.editorPanel) {
        void this.editorPanel.webview.postMessage(message);
        return;
      }
      void this.view?.webview.postMessage(message);
      return;
    }

    void this.view?.webview.postMessage(message);
    void this.editorPanel?.webview.postMessage(message);
  }

  private postToSurface(source: TerminalLocation, message: HostMessage): void {
    if (source === "editor") {
      void this.editorPanel?.webview.postMessage(message);
      return;
    }
    void this.view?.webview.postMessage(message);
  }

  private replayScrollback(source: TerminalLocation): void {
    if (!this.scrollback) {
      return;
    }
    this.postToSurface(source, { type: "output", data: this.scrollback });
  }

  private appendScrollback(data: string): void {
    this.scrollback += data;
    if (this.scrollback.length > MAX_SCROLLBACK_CHARS) {
      this.scrollback = this.scrollback.slice(this.scrollback.length - MAX_SCROLLBACK_CHARS);
    }
  }

  private configureWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"),
    );
    return renderTerminalHtml({
      cspSource: webview.cspSource,
      nonce: this.createNonce(),
      scriptUri: scriptUri.toString(),
      renderer: this.readRendererPreference(),
    });
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

  private readDefaultLocation(): TerminalLocation {
    const configuration = vscode.workspace.getConfiguration("ulw");
    const configured = configuration.get<string>("defaultLocation", "editor");
    return configured === "sidebar" ? "sidebar" : "editor";
  }

  private readRendererPreference(): "webgl" | "dom" {
    const configured = vscode.workspace
      .getConfiguration("ulw")
      .get<string>("renderer", "webgl");
    return configured === "dom" ? "dom" : "webgl";
  }

  private readConfig(): TerminalConfig {
    const configuration = vscode.workspace.getConfiguration("ulw");
    return {
      fontSize: configuration.get<number>("fontSize", 14),
      fontFamily: configuration.get<string>(
        "fontFamily",
        "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', Menlo, Monaco, 'Apple SD Gothic Neo', 'Malgun Gothic', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans', 'Noto Sans CJK KR', 'Noto Sans CJK JP', 'Noto Sans CJK SC', monospace",
      ),
      cursorBlink: configuration.get<boolean>("cursorBlink", true),
      cursorStyle: configuration.get<CursorStyle>("cursorStyle", "block"),
      scrollback: configuration.get<number>("scrollback", 10000),
    };
  }

  private createNonce(): string {
    return randomBytes(32).toString("base64");
  }
}
