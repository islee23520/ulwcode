export interface TerminalConfig {
  fontSize: number;
  fontFamily: string;
  cursorBlink: boolean;
  cursorStyle: "block" | "underline" | "bar";
  scrollback: number;
  sendKeybindingsToShell: boolean;
  autoSwitchKoreanKeyboard: boolean;
  renderer: "webgl" | "canvas" | "auto";
}

function parseRenderer(value: string | undefined): TerminalConfig["renderer"] {
  switch (value) {
    case "webgl":
    case "canvas":
    case "auto":
      return value;
    default:
      return "auto";
  }
}

export function readTerminalConfig(element: HTMLElement): TerminalConfig {
  return {
    fontSize: parseInt(element.dataset.fontSize || "14", 10),
    fontFamily:
      element.dataset.fontFamily ||
      "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'CascadiaCode NF', Menlo, monospace",
    cursorBlink: element.dataset.cursorBlink !== "false",
    cursorStyle: (element.dataset.cursorStyle || "block") as
      | "block"
      | "underline"
      | "bar",
    scrollback: parseInt(element.dataset.scrollback || "10000", 10),
    sendKeybindingsToShell: element.dataset.sendKeybindingsToShell === "true",
    autoSwitchKoreanKeyboard:
      element.dataset.autoSwitchKoreanKeyboard === "true",
    renderer: parseRenderer(element.dataset.renderer),
  };
}
