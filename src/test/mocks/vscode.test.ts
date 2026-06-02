import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "./vscode";

describe("vscode mock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscode.window.activeTextEditor = undefined;
    vscode.window.activeTerminal = undefined;
    vscode.window.terminals = [];
    vscode.window.visibleTextEditors = [];
    vscode.window.tabGroups.all = [];
    vscode.workspace.workspaceFolders = undefined;
  });

  it("exercises window registration, event, message, and terminal helpers", async () => {
    vscode.window.showInformationMessage("info");
    vscode.window.showErrorMessage("error");
    vscode.window.showWarningMessage("warning");
    vscode.window.showQuickPick(["one"]);
    vscode.window.showTextDocument(new vscode.TextDocument(vscode.Uri.file("/a.ts")));
    vscode.window.showInputBox({ prompt: "Name" });
    vscode.window.registerWebviewViewProvider("view", {});
    vscode.window.registerTreeDataProvider("tree", {});

    const tabDisposable = vscode.window.tabGroups.onDidChangeTabGroups(() => undefined);
    const editorDisposable = vscode.window.onDidChangeActiveTextEditor(() => undefined);
    const selectionDisposable = vscode.window.onDidChangeTextEditorSelection(() => undefined);
    const openTerminalDisposable = vscode.window.onDidOpenTerminal(() => undefined);
    const closeTerminalDisposable = vscode.window.onDidCloseTerminal(() => undefined);
    const terminalStateDisposable = vscode.window.onDidChangeTerminalState(() => undefined);

    tabDisposable.dispose();
    editorDisposable.dispose();
    selectionDisposable.dispose();
    openTerminalDisposable.dispose();
    closeTerminalDisposable.dispose();
    terminalStateDisposable.dispose();

    const quickPick = vscode.window.createQuickPick();
    quickPick.items = [{ label: "Item" }];
    quickPick.activeItems = quickPick.items;
    quickPick.selectedItems = quickPick.items;
    quickPick.placeholder = "placeholder";
    quickPick.title = "title";
    quickPick.busy = true;
    quickPick.enabled = false;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.value = "typed";
    quickPick.onDidAccept(() => undefined).dispose();
    quickPick.onDidChangeSelection(() => undefined).dispose();
    quickPick.onDidHide(() => undefined).dispose();
    quickPick.onDidChangeValue(() => undefined).dispose();
    quickPick.show();
    quickPick.hide();
    quickPick.dispose();

    const terminal = vscode.window.createTerminal();
    await terminal.processId;
    terminal.sendText("ls");
    terminal.show();
    terminal.hide();
    terminal.dispose();

    const panel = vscode.window.createWebviewPanel();
    panel.webview.onDidReceiveMessage(() => undefined);
    panel.webview.postMessage({ type: "ping" });
    expect(panel.webview.asWebviewUri(vscode.Uri.file("/asset.png")).fsPath).toBe(
      "/asset.png",
    );
    panel.onDidDispose(() => undefined).dispose();
    panel.reveal();
    panel.dispose();

    const serializerDisposable = vscode.window.registerWebviewPanelSerializer();
    serializerDisposable.dispose();

    const channel = vscode.window.createOutputChannel("ULW", {
      log: true,
    });
    channel.append("a");
    channel.appendLine("b");
    channel.replace("c");
    channel.clear();
    channel.show();
    channel.hide();
    channel.debug("debug");
    channel.info("info");
    channel.warn("warn");
    channel.error("error");
    expect(channel.name).toBe("ULW");
    channel.dispose();
  });

  it("exercises workspace, language, command, env, and uri helpers", async () => {
    const config = vscode.workspace.getConfiguration();
    expect(config.get("missing", "default")).toBe("default");
    expect(config.inspect()).toBeUndefined();
    config.update();

    const fileUri = vscode.Uri.file("/workspace/file.ts");
    expect(fileUri.toString()).toBe("file:///workspace/file.ts");
    const joinedUri = vscode.Uri.joinPath(fileUri, "child.ts");
    expect(joinedUri.fsPath).toBe("/workspace/file.ts/child.ts");
    expect(vscode.Uri.joinPath({ path: "/path-base" }, "child.ts").fsPath).toBe(
      "/path-base/child.ts",
    );
    expect(vscode.Uri.joinPath({}, "child.ts").path).toBe("/child.ts");
    expect(vscode.Uri.parse("file:///workspace/file.ts").scheme).toBe("file");
    expect(vscode.Uri.parse("/workspace/file.ts").fsPath).toBe("/workspace/file.ts");
    expect(vscode.workspace.asRelativePath(fileUri, false)).toBe(
      "/workspace/file.ts",
    );
    expect(vscode.workspace.asRelativePath({ path: "/path-only.ts" }, false)).toBe(
      "/path-only.ts",
    );
    expect(vscode.workspace.asRelativePath({}, false)).toBe("");
    expect(vscode.workspace.asRelativePath("src/index.ts", true)).toBe(
      "src/index.ts",
    );
    await vscode.workspace.openTextDocument(fileUri);
    vscode.workspace.onDidChangeTextDocument(() => undefined).dispose();
    vscode.workspace.findFiles("**/*.ts");

    vscode.languages.onDidChangeDiagnostics(() => undefined).dispose();
    expect(vscode.languages.getDiagnostics(fileUri)).toEqual([]);
    expect(vscode.languages.getDiagnostics()).toEqual([]);
    vscode.languages.registerCodeActionsProvider().dispose();

    vscode.commands.registerCommand("mock.command", () => undefined).dispose();
    await vscode.commands.executeCommand("mock.command", 1);
    await vscode.env.openExternal(vscode.Uri.parse("https://example.com"));
    await vscode.env.clipboard.writeText("copied");
    await vscode.env.clipboard.readText();
  });

  it("exercises exported constructors and object methods", async () => {
    expect(new vscode.ThemeColor("editor.foreground").id).toBe(
      "editor.foreground",
    );
    expect(new vscode.Position(1, 2)).toMatchObject({ line: 1, character: 2 });
    expect(new vscode.TabInputText(vscode.Uri.file("/tab.ts")).uri.fsPath).toBe(
      "/tab.ts",
    );
    expect(new vscode.Selection(0, 0, 0, 0).isEmpty).toBe(true);
    const selection = new vscode.Selection(2, 4, 1, 3);
    expect(selection.start).toEqual({ line: 1, character: 3 });
    expect(selection.end).toEqual({ line: 2, character: 4 });

    const range = vscode.Range(0, 1, 2, 3);
    expect(range.start).toEqual({ line: 0, character: 1 });

    const document = new vscode.TextDocument(
      vscode.Uri.file("/document.ts"),
      "first\n\nthird",
    );
    expect(new vscode.TextDocument({ path: "/path-only.ts" }).fileName).toBe(
      "/path-only.ts",
    );
    expect(document.lineCount).toBe(3);
    expect(document.getText()).toBe("first\n\nthird");
    expect(document.lineAt(0).range.end.character).toBe(5);
    expect(document.lineAt(1).isEmptyOrWhitespace).toBe(true);
    expect(document.lineAt(99).range.end.character).toBe(0);
    document.getWordRangeAtPosition(new vscode.Position(0, 0));
    document.offsetAt(new vscode.Position(0, 0));
    document.positionAt(0);
    document.validateRange(range);
    document.validatePosition(new vscode.Position(0, 0));
    document.save();

    const editor = new vscode.TextEditor(document, selection);
    editor.edit(() => undefined);
    editor.insertSnippet("snippet");
    editor.setDecorations("decoration", []);
    editor.revealRange(range);
    editor.show();
    editor.hide();

    const emitter = new vscode.EventEmitter<string>();
    const listener = vi.fn();
    const disposable = emitter.event(listener);
    emitter.fire("first");
    disposable.dispose();
    disposable.dispose();
    emitter.fire("second");
    emitter.dispose();
    expect(listener).toHaveBeenCalledWith("first");
    expect(listener).not.toHaveBeenCalledWith("second");

    const tokenSource = vscode.CancellationTokenSource();
    expect(tokenSource.token.isCancellationRequested).toBe(false);
    tokenSource.cancel();
    tokenSource.dispose();

    const disposableObject = new vscode.Disposable(vi.fn());
    disposableObject.dispose();

    const context = new vscode.ExtensionContext();
    context.globalState.get("key");
    context.globalState.update("key", "value");
    context.globalState.setKeysForSync(["key"]);
    context.workspaceState.get("key");
    context.workspaceState.update("key", "value");
    await context.secrets.get("secret");
    await context.secrets.store("secret", "value");
    await context.secrets.delete("secret");
    await context.extension.activate();

    const view = vscode.WebviewView();
    view.webview.onDidReceiveMessage(() => undefined).dispose();
    view.webview.postMessage({ type: "hello" });
    expect(view.webview.asWebviewUri(vscode.Uri.file("/icon.svg")).fsPath).toBe(
      "/icon.svg",
    );
    view.onDidDispose(() => undefined).dispose();
    view.onDidChangeVisibility(() => undefined).dispose();
    view.show();
    expect(vscode.WebviewViewResolveContext().state).toBeUndefined();

    expect(vscode.ConfigurationTarget.Global).toBe(1);
    expect(vscode.ConfigurationTarget.Workspace).toBe(2);
    expect(vscode.ConfigurationTarget.WorkspaceFolder).toBe(3);
    expect(vscode.DiagnosticSeverity.Error).toBe(0);
    expect(vscode.DiagnosticSeverity.Warning).toBe(1);
    expect(vscode.DiagnosticSeverity.Information).toBe(2);
    expect(vscode.DiagnosticSeverity.Hint).toBe(3);
    expect(vscode.QuickPickItemKind.Separator).toBe(-1);
    expect(vscode.QuickPickItemKind.Default).toBe(0);
    expect(vscode.ViewColumn.Active).toBe(-1);
    expect(vscode.ViewColumn.Beside).toBe(-2);
    expect(vscode.default.window).toBe(vscode.window);
  });
});
