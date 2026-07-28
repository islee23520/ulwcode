import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { HostMessage } from "../../types";
import { postMessage } from "../shared/vscode-api";
import { readTerminalTheme, watchTerminalTheme } from "./theme";

export interface TerminalView {
  readonly terminal: Terminal;
  dispose(): void;
}

export function createTerminalView(container: HTMLElement): TerminalView {
  const terminal = new Terminal({
    allowProposedApi: false,
    convertEol: true,
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily:
      "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', Menlo, monospace",
    fontSize: 14,
    scrollback: 10000,
    theme: readTerminalTheme(),
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);

  const inputDisposable = terminal.onData((data) => {
    postMessage({ type: "input", data });
  });
  const resizeDisposable = terminal.onResize(({ cols, rows }) => {
    postMessage({ type: "resize", cols, rows });
  });
  const resizeObserver = new ResizeObserver(() => fitAddon.fit());
  resizeObserver.observe(container);
  const disposeThemeWatcher = watchTerminalTheme(() => {
    terminal.options.theme = readTerminalTheme();
  });

  const messageHandler = (event: MessageEvent<HostMessage>) => {
    const message = event.data;
    switch (message.type) {
      case "output":
        terminal.write(message.data);
        break;
      case "exit":
        terminal.write(
          `\r\n\x1b[31mShell exited with code ${message.code}. Reopen the view to start a new shell.\x1b[0m\r\n`,
        );
        break;
      case "config":
        terminal.options.fontSize = message.fontSize;
        terminal.options.fontFamily = message.fontFamily;
        terminal.options.cursorBlink = message.cursorBlink;
        terminal.options.cursorStyle = message.cursorStyle;
        terminal.options.scrollback = message.scrollback;
        fitAddon.fit();
        break;
      case "focus":
        terminal.focus();
        break;
    }
  };
  window.addEventListener("message", messageHandler);

  requestAnimationFrame(() => {
    fitAddon.fit();
    postMessage({ type: "ready", cols: terminal.cols, rows: terminal.rows });
    terminal.focus();
  });

  return {
    terminal,
    dispose() {
      window.removeEventListener("message", messageHandler);
      resizeObserver.disconnect();
      disposeThemeWatcher();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
    },
  };
}
