import { h, FunctionComponent } from "preact";
import type { AiToolConfig } from "../../../types";

import { TmuxDashboardSessionDto, TmuxDashboardWindowDto } from "../types";
import { escapeHtml, renderToolBadge } from "../utils";
import { SessionMinimap } from "./SessionPreview";

export interface SessionCardProps {
  session: TmuxDashboardSessionDto;
  windows?: TmuxDashboardWindowDto[];
  tools?: AiToolConfig[];
  onActivate: (sessionId: string, workspaceUri: string | undefined) => void;
  onLaunchDefaultAiTool: (sessionId: string, sessionName: string) => void;
  onKill: (sessionId: string) => void;
}

export const SessionCard: FunctionComponent<SessionCardProps> = ({
  session,
  windows,
  tools = [],
  onActivate,
  onLaunchDefaultAiTool,
  onKill,
}) => {
  const activeClass = session.isActive ? " active" : "";
  const statusText = session.isActive ? "Current" : "Available";
  const resolvedTools = Array.from(
    new Set(
      (windows ?? [])
        .flatMap((window) => window.panes)
        .map((pane) => pane.resolvedTool)
        .filter((toolName): toolName is string => Boolean(toolName)),
    ),
  );
  const toolBadgesHtml = resolvedTools
    .map((toolName) => renderToolBadge(toolName, tools))
    .join("");

  return h(
    "div",
    {
      class: `session-card${activeClass}`,
      "data-session-id": session.id,
      "data-workspace-uri": session.workspaceUri,
      onClick: (): void => {
        onActivate(session.id, session.workspaceUri);
      },
    },
    h(
      "div",
      { class: "row" },
      h(
        "div",
        null,
        h("strong", {
          dangerouslySetInnerHTML: { __html: escapeHtml(session.name) },
        }),
        h(
          "div",
          { class: "row", style: "justify-content: flex-start; gap: 6px;" },
          h("div", {
            class: "status",
            dangerouslySetInnerHTML: { __html: escapeHtml(statusText) },
          }),
          toolBadgesHtml
            ? h("div", {
                class: "row",
                style: "justify-content: flex-start; gap: 4px;",
                dangerouslySetInnerHTML: { __html: toolBadgesHtml },
              })
            : null,
        ),
      ),
      h(
        "div",
        { class: "row", style: "gap: 8px;" },
        h(
          "button",
          {
            type: "button",
            "data-action": "launchDefaultAiTool",
            "data-session-id": session.id,
            title: "Launch AI Tool",
            onClick: (event: MouseEvent): void => {
              event.stopPropagation();
              onLaunchDefaultAiTool(session.id, session.name);
            },
          },
          "AI",
        ),
        h(
          "button",
          {
            type: "button",
            class: "danger",
            "data-action": "killSession",
            "data-session-id": session.id,
            title: "Kill Session",
            onClick: (event: MouseEvent): void => {
              event.stopPropagation();
              onKill(session.id);
            },
          },
          "✕",
        ),
      ),
    ),
    h(
      "div",
      { class: "meta-grid" },
      h("div", {
        class: "meta",
        dangerouslySetInnerHTML: {
          __html: `tmux session: ${escapeHtml(session.id)}`,
        },
      }),
      h("div", {
        class: "meta",
        dangerouslySetInnerHTML: {
          __html: `workspace: ${escapeHtml(session.workspace)}`,
        },
      }),
    ),
    windows && windows.length > 0 ? h(SessionMinimap, { windows }) : null,
  );
};
