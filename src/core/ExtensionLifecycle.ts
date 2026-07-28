import * as vscode from "vscode";
import { TerminalProvider } from "../providers/TerminalProvider";
import { TerminalManager } from "../terminals/TerminalManager";

export interface UlwExtensionApi {
  readonly onTerminalStart: vscode.Event<number>;
  readonly onTerminalData: vscode.Event<string>;
  readonly onTerminalExit: vscode.Event<number>;
  isTerminalRunning(): boolean;
  terminalCount(): number;
  writeToTerminal(data: string): void;
  toggleEditorLocation(): void;
}

export class ExtensionLifecycle implements vscode.Disposable {
  private terminalManager: TerminalManager | undefined;
  private provider: TerminalProvider | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public activate(context: vscode.ExtensionContext): UlwExtensionApi {
    const terminalManager = new TerminalManager();
    const provider = new TerminalProvider(context.extensionUri, terminalManager);
    this.terminalManager = terminalManager;
    this.provider = provider;

    const dataEmitter = new vscode.EventEmitter<string>();
    const exitEmitter = new vscode.EventEmitter<number>();
    const startEmitter = new vscode.EventEmitter<number>();
    this.disposables.push(
      startEmitter,
      dataEmitter,
      exitEmitter,
      terminalManager.onStart(({ pid }) => startEmitter.fire(pid)),
      terminalManager.onData(({ data }) => dataEmitter.fire(data)),
      terminalManager.onExit(({ code }) => exitEmitter.fire(code)),
      vscode.window.registerWebviewViewProvider(
        TerminalProvider.viewType,
        provider,
      ),
      provider,
      terminalManager,
    );
    context.subscriptions.push(this);

    const editor = vscode.window.activeTextEditor;
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e && this.provider) {
          this.provider["postMessage"]({ type: "focus" });
        }
      }),
      vscode.commands.registerCommand("ulw.toggleEditorLocation", () => {
        provider.toggleEditorLocation();
      }),
      vscode.commands.registerCommand("ulw.sendSelectionToTerminal", () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) return;
        const text = editor.document.getText(editor.selection);
        if (text) provider.write(text);
      }),
      vscode.commands.registerCommand("ulw.sendFileToTerminal", (uri: vscode.Uri) => {
        if (uri?.fsPath) provider.write(`"${uri.fsPath}"`);
      }),
    );

    return {
      onTerminalStart: startEmitter.event,
      onTerminalData: dataEmitter.event,
      onTerminalExit: exitEmitter.event,
      isTerminalRunning: () => provider.isRunning(),
      terminalCount: () => provider.terminalCount(),
      writeToTerminal: (data) => provider.write(data),
      toggleEditorLocation: () => provider.toggleEditorLocation(),
    };
  }

  public toggleEditorLocation(): void {
    this.provider?.toggleEditorLocation();
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
    this.provider = undefined;
    this.terminalManager = undefined;
  }
}
