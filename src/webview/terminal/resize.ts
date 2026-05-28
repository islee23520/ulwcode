import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { scheduleRefresh } from "../shared/utils";
import { postMessage } from "../shared/vscode-api";

export function setupResizeHandling(
  terminal: Terminal,
  fitAddon: FitAddon,
  container: HTMLElement,
): () => void {
  let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

  const handleResize = () => {
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }
    resizeTimeout = setTimeout(() => {
      if (fitAddon && terminal) {
        fitAddon.fit();
        scheduleRefresh(() => terminal.refresh(0, terminal.rows - 1));
      }
    }, 50);
  };

  window.addEventListener("resize", handleResize);

  const resizeObserver = new ResizeObserver(() => {
    handleResize();
  });
  resizeObserver.observe(container);

  return () => {
    window.removeEventListener("resize", handleResize);
    resizeObserver.disconnect();
    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }
  };
}

export function setupVisibilityHandling(
  terminal: Terminal,
  fitAddon: FitAddon,
  container: HTMLElement,
): () => void {
  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && fitAddon && terminal) {
          fitAddon.fit();
          scheduleRefresh(() => terminal.refresh(0, terminal.rows - 1));
        }
      });
    },
    { threshold: 0.1 },
  );
  visibilityObserver.observe(container);

  return () => {
    visibilityObserver.disconnect();
  };
}

export function performInitialFit(
  terminal: Terminal,
  fitAddon: FitAddon,
): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (fitAddon && terminal) {
        fitAddon.fit();
        postMessage({
          type: "ready",
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
    });
  });

  setTimeout(() => {
    if (fitAddon && terminal) {
      fitAddon.fit();
      scheduleRefresh(() => terminal.refresh(0, terminal.rows - 1));
      postMessage({
        type: "terminalResize",
        cols: terminal.cols,
        rows: terminal.rows,
      });
    }
  }, 100);

  setTimeout(() => {
    if (fitAddon && terminal) {
      fitAddon.fit();
      scheduleRefresh(() => terminal.refresh(0, terminal.rows - 1));
    }
  }, 500);
}
