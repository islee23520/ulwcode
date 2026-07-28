import type { ITheme } from "@xterm/xterm";

type ThemeColorKey = Exclude<keyof ITheme, "extendedAnsi">;

const COLOR_VARIABLES: ReadonlyArray<
  readonly [ThemeColorKey, readonly string[]]
> = [
  [
    "background",
    [
      "--vscode-terminal-background",
      "--vscode-panel-background",
      "--vscode-editor-background",
    ],
  ],
  ["foreground", ["--vscode-terminal-foreground", "--vscode-editor-foreground"]],
  ["cursor", ["--vscode-terminalCursor-foreground", "--vscode-terminal-foreground"]],
  [
    "cursorAccent",
    [
      "--vscode-terminalCursor-background",
      "--vscode-terminal-background",
    ],
  ],
  [
    "selectionBackground",
    [
      "--vscode-terminal-selectionBackground",
      "--vscode-editor-selectionBackground",
    ],
  ],
  ["selectionForeground", ["--vscode-terminal-selectionForeground"]],
  ["selectionInactiveBackground", ["--vscode-terminal-inactiveSelectionBackground"]],
  ["black", ["--vscode-terminal-ansiBlack"]],
  ["red", ["--vscode-terminal-ansiRed"]],
  ["green", ["--vscode-terminal-ansiGreen"]],
  ["yellow", ["--vscode-terminal-ansiYellow"]],
  ["blue", ["--vscode-terminal-ansiBlue"]],
  ["magenta", ["--vscode-terminal-ansiMagenta"]],
  ["cyan", ["--vscode-terminal-ansiCyan"]],
  ["white", ["--vscode-terminal-ansiWhite"]],
  ["brightBlack", ["--vscode-terminal-ansiBrightBlack"]],
  ["brightRed", ["--vscode-terminal-ansiBrightRed"]],
  ["brightGreen", ["--vscode-terminal-ansiBrightGreen"]],
  ["brightYellow", ["--vscode-terminal-ansiBrightYellow"]],
  ["brightBlue", ["--vscode-terminal-ansiBrightBlue"]],
  ["brightMagenta", ["--vscode-terminal-ansiBrightMagenta"]],
  ["brightCyan", ["--vscode-terminal-ansiBrightCyan"]],
  ["brightWhite", ["--vscode-terminal-ansiBrightWhite"]],
];

const DEFAULT_BACKGROUND = "#1e1e1e";
const DEFAULT_FOREGROUND = "#d4d4d4";

export function readTerminalTheme(): ITheme {
  const styles = [
    getComputedStyle(document.body),
    getComputedStyle(document.documentElement),
  ];
  const theme: ITheme = {};

  for (const [key, variables] of COLOR_VARIABLES) {
    const color = readColor(styles, variables);
    if (color) {
      theme[key] = color;
    }
  }

  theme.background ??= DEFAULT_BACKGROUND;
  theme.foreground ??= DEFAULT_FOREGROUND;
  theme.cursor ??= theme.foreground;
  theme.cursorAccent ??= theme.background;
  return theme;
}

export function watchTerminalTheme(onChange: () => void): () => void {
  let updateQueued = false;
  const scheduleChange = () => {
    if (updateQueued) {
      return;
    }
    updateQueued = true;
    queueMicrotask(() => {
      updateQueued = false;
      onChange();
    });
  };
  const bodyObserver = new MutationObserver(scheduleChange);
  const themeAttributes: MutationObserverInit = {
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "data-vscode-theme-kind",
      "data-vscode-theme-name",
    ],
  };
  const headObserver = new MutationObserver(scheduleChange);

  bodyObserver.observe(document.documentElement, themeAttributes);
  bodyObserver.observe(document.body, themeAttributes);
  headObserver.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => {
    bodyObserver.disconnect();
    headObserver.disconnect();
  };
}

function readColor(
  styles: readonly CSSStyleDeclaration[],
  variables: readonly string[],
): string | undefined {
  for (const variable of variables) {
    for (const style of styles) {
      const value = style.getPropertyValue(variable).trim();
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}
