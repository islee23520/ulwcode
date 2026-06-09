import { Terminal, type ITerminalAddon } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { readTerminalConfig } from "./config";
import { createKeyboardHandler } from "./keyboard";
import { copyOsc52ToClipboard, copySelectionToClipboard } from "../clipboard";
import {
  setupResizeHandling,
  setupVisibilityHandling,
  performInitialFit,
} from "./resize";
import { createLinkProvider } from "../links";
import { handleDrop } from "../dragdrop";
import { hasFileDragPayload } from "../dragdrop/file-drag";
import { postMessage } from "../shared/vscode-api";

export interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  dispose: () => void;
}

class CanvasAddonFallback implements ITerminalAddon {
  activate(): void {}

  dispose(): void {}
}

const isWindowsPlatform = (): boolean =>
  typeof navigator !== "undefined" &&
  /Windows|Win32|Win64/i.test(navigator.userAgent ?? "");

export interface WheelHandlerOptions {
  isWindows: () => boolean;
  getMouseTrackingMode: () => string;
  scrollLines: (count: number) => void;
}

export interface ContextMenuPasteHandlerOptions {
  requestPaste: () => void;
}

export function createContextMenuPasteHandler(
  options: ContextMenuPasteHandlerOptions,
) {
  return (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    options.requestPaste();
  };
}

export function createWheelHandler(options: WheelHandlerOptions) {
  return (event: WheelEvent): void => {
    if (!options.isWindows() || event.ctrlKey || event.deltaY === 0) {
      return;
    }

    // When a TUI enables mouse tracking (e.g. \x1b[?1002h),
    // let xterm.js handle the wheel event so it sends the
    // escape sequence to the PTY for the application to process.
    if (options.getMouseTrackingMode() !== "none") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    options.scrollLines(event.deltaY > 0 ? 3 : -3);
  };
}

export function initTerminal(
  container: HTMLElement,
  options: {
    onData: (data: string) => void;
    onResize: (cols: number, rows: number) => void;
    onToggleTmuxCommands: () => void;
  },
): TerminalInstance | null {
  const config = readTerminalConfig(container);

  const requestPaste = () => postMessage({ type: "triggerPaste" });
  const contextMenuHandler = createContextMenuPasteHandler({
    requestPaste,
  });
  container.addEventListener("contextmenu", contextMenuHandler);

  const terminal = new Terminal({
    cursorBlink: config.cursorBlink,
    cursorStyle: config.cursorStyle,
    fontSize: config.fontSize,
    fontFamily: config.fontFamily,
    theme: {
      background: "#1e1e1e",
      foreground: "#cccccc",
    },
    scrollback: config.scrollback,
  });

  const keyboardHandler = createKeyboardHandler({
    sendInput: (data) => options.onData(data),
    requestPaste,
    hasSelection: () => terminal.hasSelection(),
    copySelection: () => {
      const selection = terminal.getSelection();
      if (selection) {
        copySelectionToClipboard(selection);
        terminal.clearSelection();
      }
    },
    sendKeybindingsToShell: config.sendKeybindingsToShell,
  });
  terminal.attachCustomKeyEventHandler(keyboardHandler.handler);

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(
    new WebLinksAddon((_, url) => {
      postMessage({
        type: "openUrl",
        url: url,
      });
    }),
  );

  terminal.registerLinkProvider(createLinkProvider(terminal));

  terminal.open(container);
  terminal.focus();
  const osc52ClipboardHandler = terminal.parser.registerOscHandler(
    52,
    copyOsc52ToClipboard,
  );

  if (config.renderer === "canvas") {
    terminal.loadAddon(new CanvasAddonFallback());
  } else {
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch (error) {
      console.warn(
        "WebGL renderer not available, falling back to canvas:",
        error,
      );
      terminal.loadAddon(new CanvasAddonFallback());
    }
  }

  const wheelHandler = createWheelHandler({
    isWindows: isWindowsPlatform,
    getMouseTrackingMode: () => terminal.modes.mouseTrackingMode,
    scrollLines: (count) => terminal.scrollLines(count),
  });
  container.addEventListener("wheel", wheelHandler, {
    capture: true,
    passive: false,
  });

  const cleanupVisibility = setupVisibilityHandling(
    terminal,
    fitAddon,
    container,
  );
  performInitialFit(terminal, fitAddon);
  const cleanupResize = setupResizeHandling(terminal, fitAddon, container);

  terminal.onData((data) => {
    if (data) {
      options.onData(data);
    }
  });

  terminal.onResize(({ cols, rows }) => {
    options.onResize(cols, rows);
  });

  const dragOverHandler = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    const hasFiles = hasFileDragPayload(
      Array.from(e.dataTransfer.types ?? []),
      e.dataTransfer.items,
    );
    if (!hasFiles) return;
    e.preventDefault();
    e.stopPropagation();
    container.style.opacity = "0.7";
  };

  const dragLeaveHandler = (e: DragEvent) => {
    if (!e.relatedTarget) {
      container.style.opacity = "1";
    }
  };

  const dropHandler = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    container.style.opacity = "1";

    await handleDrop(e, {
      getTerminalCols: () => terminal.cols,
      getTerminalRows: () => terminal.rows,
      getScreenElement: () =>
        terminal.element?.querySelector(".xterm-screen") ?? null,
    });
  };

  // Attach at window level so Finder/OS drags are caught even when
  // xterm's WebGL canvas layers are under the cursor.
  window.addEventListener("dragover", dragOverHandler, true);
  window.addEventListener("dragleave", dragLeaveHandler, true);
  window.addEventListener("drop", dropHandler, true);

  const dispose = () => {
    cleanupResize();
    cleanupVisibility();
    container.removeEventListener("contextmenu", contextMenuHandler);
    container.removeEventListener("wheel", wheelHandler, true);
    window.removeEventListener("dragover", dragOverHandler, true);
    window.removeEventListener("dragleave", dragLeaveHandler, true);
    window.removeEventListener("drop", dropHandler, true);
    osc52ClipboardHandler.dispose();
    terminal.dispose();
  };

  return {
    terminal,
    fitAddon,
    dispose,
  };
}
