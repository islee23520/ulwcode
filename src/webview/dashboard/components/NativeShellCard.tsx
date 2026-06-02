import { h, FunctionComponent } from "preact";

import { NativeShellDto } from "../types";
import { escapeHtml } from "../utils";

export interface NativeShellCardProps {
  shell: NativeShellDto;
  onActivate: (instanceId: string, workspaceUri: string | undefined) => void;
  onKill: (instanceId: string) => void;
}

export const NativeShellCard: FunctionComponent<NativeShellCardProps> = ({
  shell,
  onActivate,
  onKill,
}) => {
  const activeClass = shell.isActive ? " active" : "";
  const statusText = shell.isActive ? "Current" : "Available";
  const stateLabel = shell.state || "disconnected";

  return h(
    "div",
    {
      class: `session-card${activeClass}`,
      "data-native-shell-id": shell.id,
      "data-workspace-uri": shell.workspaceUri,
      onClick: (): void => {
        onActivate(shell.id, shell.workspaceUri);
      },
    },
    h(
      "div",
      { class: "row" },
      h(
        "div",
        null,
        h("strong", {
          dangerouslySetInnerHTML: {
            __html: escapeHtml(shell.label || "Shell"),
          },
        }),
        h("div", {
          class: "status",
          dangerouslySetInnerHTML: { __html: escapeHtml(statusText) },
        }),
      ),
      h(
        "button",
        {
          type: "button",
          class: "danger",
          "data-action": "killNativeShell",
          "data-native-shell-id": shell.id,
          title: "Close Shell",
          onClick: (event: MouseEvent): void => {
            event.stopPropagation();
            onKill(shell.id);
          },
        },
        "✕",
      ),
    ),
    h(
      "div",
      { class: "meta-grid" },
      h("div", {
        class: "meta",
        dangerouslySetInnerHTML: {
          __html: `native shell · ${escapeHtml(stateLabel)}`,
        },
      }),
    ),
  );
};
