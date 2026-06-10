import { h, FunctionComponent, Fragment } from "preact";

import type { DashboardPayload } from "../types";
import { EmptyState } from "./EmptyState";
import { NativeShellCard } from "./NativeShellCard";
import { ReturnBanner } from "./ReturnBanner";
import { SessionCard } from "./SessionCard";

export interface AppProps {
  payload: DashboardPayload;
  onAction: (action: Record<string, unknown>) => void;
}

export const App: FunctionComponent<AppProps> = ({
  payload,
  onAction,
}) => {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const nativeShells = Array.isArray(payload.nativeShells)
    ? payload.nativeShells
    : [];
  const threadProjects = Array.isArray(payload.threadHistory?.projects)
    ? payload.threadHistory.projects
    : [];
  const isCurrentWorkspace = (workspaceUri: string | undefined): boolean => {
    if (payload.workspaceUri && workspaceUri) {
      return workspaceUri === payload.workspaceUri;
    }
    return false;
  };
  const activeOther = sessions.find((session) => {
    if (!session.isActive) {
      return false;
    }
    if (payload.workspaceUri) {
      return !isCurrentWorkspace(session.workspaceUri);
    }
    return session.workspace !== payload.workspace;
  });

  const handleAction = (action: Record<string, unknown>): void => {
    onAction(action);
  };

  if (
    sessions.length === 0 &&
    nativeShells.length === 0 &&
    threadProjects.length === 0
  ) {
    return h(EmptyState, { tmuxAvailable: payload.tmuxAvailable });
  }

  return h(
    Fragment,
    null,
    activeOther
      ? h(ReturnBanner, {
          workspace: payload.workspace || "current workspace",
          onReturn: (): void => {
            const matching = sessions.find((session) =>
              payload.workspaceUri
                ? isCurrentWorkspace(session.workspaceUri)
                : session.workspace === payload.workspace,
            );
            if (matching) {
              handleAction({
                action: "activate",
                sessionId: matching.id,
                workspaceUri: matching.workspaceUri,
              });
              return;
            }
            handleAction({ action: "create" });
          },
          onCreate: (): void => {
            handleAction({ action: "create" });
          },
        })
      : null,
    nativeShells.map((shell) =>
      h(NativeShellCard, {
        key: shell.id,
        shell,
        onActivate: (instanceId, workspaceUri): void => {
          handleAction({
            action: "activateNativeShell",
            instanceId,
            workspaceUri,
          });
        },
        onKill: (instanceId): void => {
          handleAction({ action: "killNativeShell", instanceId });
        },
      }),
    ),
    threadProjects.length > 0
      ? h(
          "section",
          { class: "thread-history", "data-thread-history": "true" },
          h(
            "div",
            { class: "thread-history-header" },
            h("h2", null, "Project History"),
            h(
              "button",
              {
                type: "button",
                "data-action": "toggleThreadHistory",
                onClick: (): void => {
                  handleAction({ action: "toggleThreadHistory" });
                },
              },
              payload.showingThreadHistory ? "Hide" : "Show",
            ),
          ),
          payload.showingThreadHistory
            ? threadProjects.map((project) =>
                h(
                  "div",
                  {
                    key: project.workspaceUri ?? project.workspaceName,
                    class: "thread-project-group",
                    "data-thread-project":
                      project.workspaceUri ?? project.workspaceName,
                  },
                  h("h3", null, project.workspaceName),
                  project.entries.map((entry) =>
                    h(
                      "div",
                      {
                        key: entry.id,
                        class: "thread-history-row",
                        "data-thread-id": entry.id,
                      },
                      h("span", { class: "thread-title" }, entry.title),
                      h("span", { class: "thread-status" }, entry.status),
                      h(
                        "button",
                        {
                          type: "button",
                          "data-action": entry.archived
                            ? "restoreThread"
                            : "archiveThread",
                          onClick: (): void => {
                            handleAction({
                              action: entry.archived
                                ? "restoreThread"
                                : "archiveThread",
                              threadId: entry.id,
                            });
                          },
                        },
                        entry.archived ? "Restore" : "Archive",
                      ),
                      h(
                        "button",
                        {
                          type: "button",
                          "data-action": "deleteThread",
                          onClick: (): void => {
                            handleAction({
                              action: "deleteThread",
                              threadId: entry.id,
                            });
                          },
                        },
                        "Delete",
                      ),
                    ),
                  ),
                ),
              )
            : null,
        )
      : null,
    sessions.map((session) =>
      h(SessionCard, {
        key: session.id,
        session,
        windows: payload.windows?.[session.id],
        tools: payload.tools,
        onActivate: (sessionId, workspaceUri): void => {
          handleAction({ action: "activate", sessionId, workspaceUri });
        },
        onKill: (sessionId): void => {
          handleAction({ action: "killSession", sessionId });
        },
      }),
    ),
  );
};
