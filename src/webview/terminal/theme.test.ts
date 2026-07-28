// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { readTerminalTheme, watchTerminalTheme } from "./theme";

describe("readTerminalTheme", () => {
  it("maps VS Code terminal colors into the xterm theme", () => {
    const root = document.documentElement;
    root.style.setProperty("--vscode-terminal-background", "#010203");
    root.style.setProperty("--vscode-terminal-foreground", "#f1f2f3");
    root.style.setProperty("--vscode-terminalCursor-foreground", "#abcdef");
    root.style.setProperty("--vscode-terminal-selectionBackground", "#445566");
    root.style.setProperty("--vscode-terminal-ansiRed", "#ff0000");
    root.style.setProperty("--vscode-terminal-ansiBrightBlue", "#0088ff");

    expect(readTerminalTheme()).toMatchObject({
      background: "#010203",
      foreground: "#f1f2f3",
      cursor: "#abcdef",
      selectionBackground: "#445566",
      red: "#ff0000",
      brightBlue: "#0088ff",
    });
  });

  it("falls back to editor colors when terminal colors are absent", () => {
    const root = document.documentElement;
    root.removeAttribute("style");
    root.style.setProperty("--vscode-editor-background", "#111111");
    root.style.setProperty("--vscode-editor-foreground", "#eeeeee");

    expect(readTerminalTheme()).toMatchObject({
      background: "#111111",
      foreground: "#eeeeee",
    });
  });

  it("prefers the panel background before the editor background", () => {
    const root = document.documentElement;
    root.removeAttribute("style");
    root.style.setProperty("--vscode-panel-background", "#222222");
    root.style.setProperty("--vscode-editor-background", "#111111");

    expect(readTerminalTheme().background).toBe("#222222");
  });

  it("coalesces body and injected style mutations", async () => {
    let resolveChange: (() => void) | undefined;
    const changed = new Promise<void>((resolve) => {
      resolveChange = resolve;
    });
    const onChange = vi.fn(() => resolveChange?.());
    const dispose = watchTerminalTheme(onChange);
    const style = document.createElement("style");
    document.head.append(style);
    document.body.className = "vscode-light";
    style.textContent = ":root { --vscode-terminal-background: #ffffff; }";

    await changed;

    expect(onChange).toHaveBeenCalledOnce();
    dispose();
    document.body.className = "vscode-dark";
    style.textContent = ":root { --vscode-terminal-background: #000000; }";
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledOnce();
    style.remove();
  });
});
