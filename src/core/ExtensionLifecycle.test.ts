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
});
