import type { TerminalBackendType } from "../types";
import { postMessage } from "./shared/vscode-api";
import * as TmuxCmd from "./tmux-command-dropdown";
import * as TmuxPrompt from "./tmux-prompt";

export interface TmuxEventOptions {
  readonly getCurrentSessionId: () => string | null;
  readonly getActiveBackend: () => TerminalBackendType;
}

type TmuxPromptChoice = "tmux" | "shell" | "zellij";

function parseTmuxPromptChoice(value: unknown): TmuxPromptChoice {
  switch (value) {
    case "shell":
    case "zellij":
      return value;
    default:
      return "tmux";
  }
}

function isTmuxPromptChoiceMessage(
  message: unknown,
): message is { readonly type: "sendTmuxPromptChoice"; readonly choice: unknown } {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "sendTmuxPromptChoice" &&
    "choice" in message
  );
}

const tmuxPromptCallbacks = {
  postMessage: (msg: unknown) => {
    if (isTmuxPromptChoiceMessage(msg)) {
      postMessage({
        type: "sendTmuxPromptChoice",
        choice: parseTmuxPromptChoice(msg.choice),
      });
    }
  },
};

export function setupTmuxEvents(options: TmuxEventOptions): void {
  document.addEventListener("keydown", (event) => {
    const isToggleTmuxCommand =
      event.altKey && (event.metaKey || event.ctrlKey) && event.code === "KeyM";
    if (isToggleTmuxCommand) {
      const currentSessionId = options.getCurrentSessionId();
      if (currentSessionId) {
        event.preventDefault();
        if (TmuxCmd.isVisible()) {
          TmuxCmd.hide();
        } else {
          TmuxCmd.show(currentSessionId, options.getActiveBackend());
        }
      }
      return;
    }

    if (TmuxCmd.isVisible()) {
      TmuxCmd.handleKeydown(event);
    }
  });

  document.addEventListener("click", (event) => {
    const target = event
      .composedPath()
      .find((element): element is Element => element instanceof Element);
    if (!target) return;
    if (TmuxPrompt.isVisible()) {
      TmuxPrompt.handleClick(target, tmuxPromptCallbacks);
    }

    if (TmuxCmd.isVisible()) {
      if (
        target.closest(".tmux-cmd-item") &&
        !target.closest(".tmux-cmd-item.disabled")
      ) {
        TmuxCmd.handleClick(target);
      } else if (
        !target.closest("#tmux-command-dropdown") &&
        !target.closest("#btn-tmux-commands")
      ) {
        TmuxCmd.hide();
      }
    }
  });
}
