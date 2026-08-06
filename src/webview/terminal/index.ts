import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import type { HostMessage } from "../../types";
import { postMessage } from "../shared/vscode-api";
import { readTerminalTheme, watchTerminalTheme } from "./theme";

export interface TerminalView {
  readonly terminal: Terminal;
  dispose(): void;
}

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

type RendererPreference = "webgl" | "dom";

function readRendererPreference(): RendererPreference {
  return (globalThis as { __ulwRenderer?: unknown }).__ulwRenderer === "dom"
    ? "dom"
    : "webgl";
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

  if (readRendererPreference() !== "dom") {
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch (error) {
      console.warn("WebGL renderer unavailable, using DOM renderer:", error);
    }
  }

  const inputDisposable = terminal.onData((data) => {
    postMessage({ type: "input", data });
  });
  const resizeDisposable = terminal.onResize(({ cols, rows }) => {
    postMessage({ type: "resize", cols, rows });
  });
  const repaint = (): void => {
    terminal.refresh(0, terminal.rows - 1);
  };
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    repaint();
  });
  resizeObserver.observe(container);
  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          fitAddon.fit();
          repaint();
        }
      }
    },
    { threshold: 0.1 },
  );
  visibilityObserver.observe(container);
  const copySelection = () => {
    const text = terminal.getSelection();
    if (text) {
      postMessage({ type: "copy", text });
    }
  };
  container.addEventListener("mouseup", copySelection);
  const disposeThemeWatcher = watchTerminalTheme(() => {
    terminal.options.theme = readTerminalTheme();
  });

  const handlePasteEvent = (event: ClipboardEvent): void => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) =>
      ALLOWED_IMAGE_TYPES.includes(item.type as (typeof ALLOWED_IMAGE_TYPES)[number]),
    );
    if (!imageItem) {
      return;
    }

    const blob = imageItem.getAsFile();
    if (!blob || blob.size > MAX_IMAGE_SIZE) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        postMessage({ type: "imagePasted", data: reader.result });
      }
    };
    reader.readAsDataURL(blob);
  };
  container.addEventListener("paste", handlePasteEvent);

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
      case "clipboardImage":
        terminal.paste(message.filePath);
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
      container.removeEventListener("mouseup", copySelection);
      container.removeEventListener("paste", handlePasteEvent);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      disposeThemeWatcher();
      inputDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
    },
  };
}
