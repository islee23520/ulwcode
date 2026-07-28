import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { createTerminalView } from "./terminal";

function start(): void {
  const container = document.getElementById("terminal-container");
  if (!container) {
    throw new Error("ULW terminal container is missing");
  }
  createTerminalView(container);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
