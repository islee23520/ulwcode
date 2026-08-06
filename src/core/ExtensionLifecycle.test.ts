import { describe, expect, it, vi } from "vitest";
import * as vscode from "../test/mocks/vscode";
import { TerminalManager } from "../terminals/TerminalManager";
import { ExtensionLifecycle } from "./ExtensionLifecycle";

vi.mock("node-pty", async () => vi.importActual("../test/mocks/node-pty"));

function createContext() {
  return {
    extensionUri: vscode.Uri.file("/extension"),
    subscriptions: [] as vscode.Disposable[],
  };
}

describe("ExtensionLifecycle", () => {
  it("registers exactly one secondary-sidebar provider", () => {
    vscode.resetMocks();
    const context = createContext();
    const lifecycle = new ExtensionLifecycle();

    lifecycle.activate(context as never);

    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledOnce();
    expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
      "ulw",
      expect.anything(),
    );
    expect(context.subscriptions).toEqual([lifecycle]);
  });

  it("exposes terminal events and delegates API operations", () => {
    vscode.resetMocks();
    const context = createContext();
    const lifecycle = new ExtensionLifecycle();
    const api = lifecycle.activate(context as never);
    const manager = lifecycle["terminalManager"] as TerminalManager;
    const start = vi.fn();
    const data = vi.fn();
    const exit = vi.fn();
    api.onTerminalStart(start);
    api.onTerminalData(data);
    api.onTerminalExit(exit);
    const write = vi.spyOn(manager, "write");

    manager["startEmitter"].fire({ id: "sidebar-shell", pid: 42 });
    manager["dataEmitter"].fire({ id: "sidebar-shell", data: "hello" });
    manager["exitEmitter"].fire({ id: "sidebar-shell", code: 3 });
    api.writeToTerminal("pwd\r");

    expect(start).toHaveBeenCalledWith(42);
    expect(data).toHaveBeenCalledWith("hello");
    expect(exit).toHaveBeenCalledWith(3);
    expect(write).toHaveBeenCalledWith("sidebar-shell", "pwd\r");
    expect(api.isTerminalRunning()).toBe(false);
    expect(api.terminalCount()).toBe(0);

    lifecycle.dispose();
    expect(lifecycle["terminalManager"]).toBeUndefined();
    expect(lifecycle["provider"]).toBeUndefined();
  });

  it("opens the terminal in the editor group when toggled", () => {
    vscode.resetMocks();
    const context = createContext();
    const lifecycle = new ExtensionLifecycle();
    lifecycle.activate(context as never);

    lifecycle.toggleEditorLocation();

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      "ulw.terminalEditor",
      "ULW Terminal",
      expect.anything(),
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it("registers the editor location toggle command", () => {
    vscode.resetMocks();
    const context = createContext();
    const lifecycle = new ExtensionLifecycle();
    lifecycle.activate(context as never);

    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      "ulw.toggleEditorLocation",
      expect.any(Function),
    );
  });

  it("opens the editor group when ulw.defaultLocation is editor", () => {
    vscode.resetMocks();
    vscode.setConfiguration({ "ulw.defaultLocation": "editor" });
    const context = createContext();
    const lifecycle = new ExtensionLifecycle();

    lifecycle.activate(context as never);

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      "ulw.terminalEditor",
      "ULW Terminal",
      expect.anything(),
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it("opens the editor group by default when ulw.defaultLocation is unset", () => {
    vscode.resetMocks();
    const context = createContext();
    const lifecycle = new ExtensionLifecycle();

    lifecycle.activate(context as never);

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      "ulw.terminalEditor",
      "ULW Terminal",
      expect.anything(),
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it("stays on the sidebar when ulw.defaultLocation is sidebar", () => {
    vscode.resetMocks();
    vscode.setConfiguration({ "ulw.defaultLocation": "sidebar" });
    const context = createContext();
    const lifecycle = new ExtensionLifecycle();

    lifecycle.activate(context as never);

    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("shell-escapes paths sent via sendFileToTerminal", () => {
    vscode.resetMocks();
    const context = createContext();
    const lifecycle = new ExtensionLifecycle();
    const api = lifecycle.activate(context as never);
    const provider = lifecycle["provider"] as TerminalProvider;
    const writeSpy = vi.spyOn(provider, "write");

    api.writeToTerminal;
    const handlers = vscode.commands.registerCommand.mock.calls as readonly [
      string,
      (uri?: { fsPath?: string }) => void,
    ][];
    const sendFile = handlers.find(
      ([id]) => id === "ulw.sendFileToTerminal",
    )?.[1];
    expect(sendFile).toBeDefined();

    sendFile?.({ fsPath: "/safe/path" });
    expect(writeSpy).toHaveBeenLastCalledWith("'/safe/path'");

    sendFile?.({ fsPath: "name'$(whoami)'" });
    expect(writeSpy).toHaveBeenLastCalledWith("'name'\\''$(whoami)'\\'''");
  });
});
