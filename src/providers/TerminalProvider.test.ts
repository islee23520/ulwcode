import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ptyMock from "../test/mocks/node-pty";
import type { HostMessage, WebviewMessage } from "../types";
import * as vscode from "../test/mocks/vscode";
import { TerminalManager } from "../terminals/TerminalManager";
import { TerminalProvider } from "./TerminalProvider";

vi.mock("node-pty", async () => vi.importActual("../test/mocks/node-pty"));

const nodePty = await vi.importActual<typeof ptyMock>("../test/mocks/node-pty");

interface TestWebview {
  html: string;
  options: unknown;
  readonly cspSource: string;
  readonly postMessage: ReturnType<typeof vi.fn>;
  asWebviewUri(uri: vscode.Uri): vscode.Uri;
  onDidReceiveMessage(listener: (message: WebviewMessage) => void): vscode.Disposable;
  send(message: WebviewMessage): void;
}

function createView(): { readonly view: unknown; readonly webview: TestWebview } {
  const messageEmitter = new vscode.EventEmitter<WebviewMessage>();
  const disposeEmitter = new vscode.EventEmitter<void>();
  const webview: TestWebview = {
    html: "",
    options: undefined,
    cspSource: "vscode-webview:",
    postMessage: vi.fn(async (_message: HostMessage) => true),
    asWebviewUri: (uri) => uri,
    onDidReceiveMessage: messageEmitter.event,
    send: (message) => messageEmitter.fire(message),
  };
  return {
    view: {
      webview,
      onDidDispose: disposeEmitter.event,
    },
    webview,
  };
}

describe("TerminalProvider", () => {
  beforeEach(() => vscode.resetMocks());

  it("starts one shell from ready and forwards the terminal contract", () => {
    const manager = new TerminalManager();
    const createSpy = vi.spyOn(manager, "createTerminal");
    const writeSpy = vi.spyOn(manager, "write");
    const resizeSpy = vi.spyOn(manager, "resize");
    const provider = new TerminalProvider(vscode.Uri.file("/extension"), manager);
    const { view, webview } = createView();

    provider.resolveWebviewView(view as never);
    webview.send({ type: "ready", cols: 90, rows: 28 });
    webview.send({ type: "input", data: "pwd\r" });
    webview.send({ type: "resize", cols: 100, rows: 30 });

    expect(createSpy).toHaveBeenCalledOnce();
    expect(createSpy).toHaveBeenCalledWith("sidebar-shell", 90, 28);
    expect(writeSpy).toHaveBeenCalledWith("sidebar-shell", "pwd\r");
    expect(resizeSpy).toHaveBeenCalledWith("sidebar-shell", 100, 30);
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "config", fontSize: 14 }),
    );
    expect(webview.postMessage).toHaveBeenCalledWith({ type: "focus" });
    expect(webview.html).toContain('id="terminal-container"');
  });

  it("forwards PTY output and exit without pane or session metadata", () => {
    const manager = new TerminalManager();
    const provider = new TerminalProvider(vscode.Uri.file("/extension"), manager);
    const { view, webview } = createView();
    provider.resolveWebviewView(view as never);
    webview.send({ type: "ready", cols: 80, rows: 24 });
    const process = nodePty.spawn.mock.results.at(-1)
      ?.value as ptyMock.MockPtyProcess;

    process.emitData("hello");
    process.emitExit(0);

    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "output",
      data: "hello",
    });
    expect(webview.postMessage).toHaveBeenCalledWith({
      type: "exit",
      code: 0,
      signal: undefined,
    });
  });

  it("copies drag-selected terminal text through the host clipboard", () => {
    const manager = new TerminalManager();
    const provider = new TerminalProvider(vscode.Uri.file("/extension"), manager);
    const { view, webview } = createView();
    provider.resolveWebviewView(view as never);

    webview.send({ type: "copy", text: "selected output" });

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
      "selected output",
    );
  });

  it("ignores empty drag selections", () => {
    const manager = new TerminalManager();
    const provider = new TerminalProvider(vscode.Uri.file("/extension"), manager);
    const { view, webview } = createView();
    provider.resolveWebviewView(view as never);

    webview.send({ type: "copy", text: "" });

    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("saves pasted images and posts their path to the terminal", async () => {
    const manager = new TerminalManager();
    const provider = new TerminalProvider(vscode.Uri.file("/extension"), manager);
    const { view, webview } = createView();
    provider.resolveWebviewView(view as never);
    webview.send({ type: "ready", cols: 80, rows: 24 });

    webview.send({
      type: "imagePasted",
      data: "data:image/png;base64,ZmFrZQ==",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "clipboardImage" }),
    );
  });

  it("rejects oversized images", () => {
    const manager = new TerminalManager();
    const provider = new TerminalProvider(vscode.Uri.file("/extension"), manager);
    const { view, webview } = createView();
    provider.resolveWebviewView(view as never);
    webview.send({ type: "ready", cols: 80, rows: 24 });
    const largeBase64 = Buffer.alloc(6 * 1024 * 1024).toString("base64");

    webview.send({
      type: "imagePasted",
      data: `data:image/png;base64,${largeBase64}`,
    });

    expect(webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "clipboardImage" }),
    );
  });

  it("rejects malformed image data", () => {
    const manager = new TerminalManager();
    const provider = new TerminalProvider(vscode.Uri.file("/extension"), manager);
    const { view, webview } = createView();
    provider.resolveWebviewView(view as never);
    webview.send({ type: "ready", cols: 80, rows: 24 });

    webview.send({ type: "imagePasted", data: "not-a-data-url" });

    expect(webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "clipboardImage" }),
    );
  });

  it("kills the native shell when disposed", () => {
    const manager = new TerminalManager();
    const provider = new TerminalProvider(vscode.Uri.file("/extension"), manager);
    const { view, webview } = createView();
    provider.resolveWebviewView(view as never);
    webview.send({ type: "ready", cols: 80, rows: 24 });
    const killSpy = vi.spyOn(manager, "kill");

    provider.dispose();

    expect(killSpy).toHaveBeenCalledWith("sidebar-shell");
  });

  it("reuses the existing shell and reacts to terminal settings", () => {
    const manager = new TerminalManager();
    const provider = new TerminalProvider(vscode.Uri.file("/extension"), manager);
    const { view, webview } = createView();
    provider.resolveWebviewView(view as never);
    webview.send({ type: "ready", cols: 80, rows: 24 });
    const create = vi.spyOn(manager, "createTerminal");
    const resize = vi.spyOn(manager, "resize");
    vscode.setConfiguration({ "ulw.fontSize": 18 });

    webview.send({ type: "ready", cols: 120, rows: 40 });
    vscode.fireConfigurationChange("editor");
    vscode.fireConfigurationChange("ulw");

    expect(create).not.toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith("sidebar-shell", 120, 40);
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "config", fontSize: 18 }),
    );
  });

  it("filters unrelated PTY events and disconnects a disposed view", () => {
    const manager = new TerminalManager();
    const provider = new TerminalProvider(vscode.Uri.file("/extension"), manager);
    const { view, webview } = createView();
    provider.resolveWebviewView(view as never);
    const count = webview.postMessage.mock.calls.length;

    manager["dataEmitter"].fire({ id: "other", data: "ignored" });
    manager["exitEmitter"].fire({ id: "other", code: 1 });
    (view as { onDidDispose: (listener: () => void) => vscode.Disposable })
      .onDidDispose(() => undefined);
    provider["view"] = undefined;
    provider["postMessage"]({ type: "focus" });

    expect(webview.postMessage).toHaveBeenCalledTimes(count);
  });
});
