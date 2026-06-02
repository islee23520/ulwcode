import { postMessage } from "../shared/vscode-api";
import {
  TerminalBackendAvailability,
  TerminalBackendType,
  TmuxWebviewCommandId,
} from "../../types";

import * as TmuxCmd from "../tmux-command-dropdown";

export function setupTmuxCommandButton(
  getSessionId: () => string | null,
  getActiveBackend: () => TerminalBackendType = () => "tmux",
): void {
  const btnTmuxCommands = document.getElementById("btn-tmux-commands");
  btnTmuxCommands?.addEventListener("click", () => {
    TmuxCmd.isVisible()
      ? TmuxCmd.hide()
      : TmuxCmd.show(getSessionId(), getActiveBackend());
  });
}

export function setupBackendToggleButton(
  _getActiveBackend?: () => TerminalBackendType,
): void {
  const btn = document.getElementById("btn-toggle-backend");
  btn?.addEventListener("click", () => {
    postMessage({ type: "cycleTerminalBackend" });
  });
}

export function setupTmuxWindowButtons(): void {
  bindTmuxCommandButton(
    "btn-new-editor-terminal",
    "ulw.openNewSessionTerminalInEditor",
  );
  bindTmuxCommandButton(
    "btn-tmux-split-horizontal",
    "ulw.tmuxSplitPaneH",
  );
  bindTmuxCommandButton(
    "btn-tmux-split-vertical",
    "ulw.tmuxSplitPaneV",
  );
  bindTmuxCommandButton("btn-tmux-prev-window", "ulw.tmuxPrevWindow");
  bindTmuxCommandButton("btn-tmux-new-window", "ulw.tmuxCreateWindow");
  bindTmuxCommandButton("btn-tmux-next-window", "ulw.tmuxNextWindow");
}

function bindTmuxCommandButton(
  elementId: string,
  commandId: TmuxWebviewCommandId,
): void {
  document.getElementById(elementId)?.addEventListener("click", () => {
    postMessage({ type: "executeTmuxCommand", commandId });
  });
}

export function updateBackendToggleButtonState(
  activeBackend: TerminalBackendType,
  availability: TerminalBackendAvailability,
): void {
  updateTmuxWindowButtonState(activeBackend, availability);

  const btn = document.getElementById(
    "btn-toggle-backend",
  ) as HTMLButtonElement | null;
  if (!btn) return;

  const next = nextAvailableBackend(activeBackend, availability);
  btn.disabled = next === activeBackend;
  btn.title = btn.disabled
    ? "No other terminal backend is available"
    : `Switch to ${backendLabel(next)}`;
  btn.textContent = backendGlyph(activeBackend);
}

function updateTmuxWindowButtonState(
  activeBackend: TerminalBackendType,
  availability: TerminalBackendAvailability,
): void {
  const sessionButton = document.getElementById(
    "btn-tmux-new-session",
  ) as HTMLButtonElement | null;
  if (sessionButton) {
    sessionButton.disabled = !availability.tmux;
    sessionButton.title = availability.tmux
      ? "New tmux session"
      : "tmux is not available";
  }

  const windowButtons = [
    ["btn-tmux-prev-window", "Previous tmux window"],
    ["btn-tmux-new-window", "New tmux window"],
    ["btn-tmux-next-window", "Next tmux window"],
  ] as const;
  const paneButtons = [
    ["btn-tmux-split-horizontal", "Split pane horizontally"],
    ["btn-tmux-split-vertical", "Split pane vertically"],
  ] as const;

  const isTmuxActive = activeBackend === "tmux" && availability.tmux;
  windowButtons.forEach(([id, activeTitle]) => {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (!button) return;
    button.disabled = !isTmuxActive;
    button.title = isTmuxActive
      ? activeTitle
      : activeBackend === "zellij"
        ? "Use tab controls from commands"
        : "Switch to tmux to manage windows";
  });

  const canSplitPanes =
    (activeBackend === "tmux" && availability.tmux) ||
    (activeBackend === "zellij" && availability.zellij);
  paneButtons.forEach(([id, activeTitle]) => {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (!button) return;
    button.disabled = !canSplitPanes;
    button.title = canSplitPanes
      ? activeTitle
      : "Switch to tmux or zellij to split panes";
  });
}

function nextAvailableBackend(
  activeBackend: TerminalBackendType,
  availability: TerminalBackendAvailability,
): TerminalBackendType {
  const order: TerminalBackendType[] = ["native", "tmux", "zellij"];
  const start = order.indexOf(activeBackend);
  const offset = start >= 0 ? start : 0;
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(offset + step) % order.length];
    if (availability[candidate]) {
      return candidate;
    }
  }
  return activeBackend;
}

function backendLabel(backend: TerminalBackendType): string {
  if (backend === "tmux") return "Tmux";
  if (backend === "zellij") return "Zellij";
  return "Native Shell";
}

function backendGlyph(backend: TerminalBackendType): string {
  if (backend === "tmux") return "T";
  if (backend === "zellij") return "Z";
  return "N";
}

export function setupReloadButton(): void {
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    postMessage({ type: "requestRestart" });
  });
}

export function setupEditorAttachmentButton(): void {
  document
    .getElementById("btn-toggle-editor-attachment")
    ?.addEventListener("click", () => {
      postMessage({ type: "toggleEditorAttachment" });
    });
}
