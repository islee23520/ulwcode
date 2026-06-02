// @vitest-environment jsdom

import { h, render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const aiToolMock = vi.hoisted(() => ({
  isVisible: vi.fn(() => false),
  show: vi.fn(),
  hide: vi.fn(),
}));

vi.mock("../../ai-tool-selector", () => aiToolMock);

describe("dashboard App", () => {
  afterEach(() => {
    render(null, document.body);
    document.body.innerHTML = "";
    vi.clearAllMocks();
    aiToolMock.isVisible.mockReturnValue(false);
  });

  it("forwards the dashboard AI button action through onAction with session name", () => {
    const onAction = vi.fn();

    render(
      h(App, {
        payload: {
          sessions: [
            {
              id: "repo-a",
              name: "Repo A",
              workspace: "repo-a",
              isActive: true,
              preview: "",
            },
          ],
          workspace: "repo-a",
        },
        onAction,
      }),
      document.body,
    );

    const button = document.querySelector(
      '[data-action="showAiToolSelector"]',
    );

    expect(button).toBeInstanceOf(HTMLButtonElement);

    button?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(onAction).toHaveBeenCalledWith({
      action: "showAiToolSelector",
      sessionId: "repo-a",
      sessionName: "Repo A",
    });
    expect(aiToolMock.show).not.toHaveBeenCalled();
  });

  it("renders resolved pane tool badges for node-based panes", () => {
    render(
      h(App, {
        payload: {
          sessions: [
            {
              id: "repo-a",
              name: "Repo A",
              workspace: "repo-a",
              isActive: true,
              preview: "",
            },
          ],
          windows: {
            "repo-a": [
              {
                windowId: "@1",
                index: 0,
                name: "main",
                isActive: true,
                panes: [
                  {
                    paneId: "%1",
                    index: 0,
                    title: "shell",
                    isActive: true,
                    currentCommand: "node",
                    resolvedTool: "opencode",
                  },
                  {
                    paneId: "%2",
                    index: 1,
                    title: "shell",
                    isActive: false,
                    currentCommand: "node",
                    resolvedTool: "codex",
                  },
                ],
              },
            ],
          },
          tools: [
            {
              name: "opencode",
              label: "OpenCode",
              path: "",
              args: ["-c"],
              operator: "opencode",
            },
            {
              name: "codex",
              label: "Codex",
              path: "",
              args: [],
              operator: "codex",
            },
          ],
          workspace: "repo-a",
        },
        onAction: vi.fn(),
      }),
      document.body,
    );

    const badges = Array.from(document.querySelectorAll(".pane-tool-badge"));
    expect(badges).toHaveLength(2);
    expect(badges.map((badge) => badge.textContent)).toEqual(["OC", "CX"]);
  });

  it("forwards session project activation with workspace URI", () => {
    const onAction = vi.fn();

    render(
      h(App, {
        payload: {
          sessions: [
            {
              id: "repo-a",
              name: "Repo A",
              workspace: "repo-a",
              workspaceUri: "file:///workspaces/repo-a",
              isActive: true,
            },
          ],
          workspace: "repo-a",
        },
        onAction,
      }),
      document.body,
    );

    const card = document.querySelector('[data-session-id="repo-a"]');
    expect(card).toBeInstanceOf(HTMLDivElement);

    card?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(onAction).toHaveBeenCalledWith({
      action: "activate",
      sessionId: "repo-a",
      workspaceUri: "file:///workspaces/repo-a",
    });
  });

  it("forwards native shell project activation with workspace URI", () => {
    const onAction = vi.fn();

    render(
      h(App, {
        payload: {
          sessions: [],
          nativeShells: [
            {
              id: "shell-a",
              label: "Shell A",
              state: "connected",
              isActive: false,
              workspaceUri: "file:///workspaces/repo-shell",
            },
          ],
          workspace: "repo-a",
        },
        onAction,
      }),
      document.body,
    );

    const card = document.querySelector('[data-native-shell-id="shell-a"]');
    expect(card).toBeInstanceOf(HTMLDivElement);

    card?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(onAction).toHaveBeenCalledWith({
      action: "activateNativeShell",
      instanceId: "shell-a",
      workspaceUri: "file:///workspaces/repo-shell",
    });
  });

  it("uses workspace URI to return to the current project when names match", () => {
    const onAction = vi.fn();

    render(
      h(App, {
        payload: {
          sessions: [
            {
              id: "repo-alpha",
              name: "Repo Alpha",
              workspace: "repo",
              workspaceUri: "file:///workspaces/alpha/repo",
              isActive: false,
            },
            {
              id: "repo-beta",
              name: "Repo Beta",
              workspace: "repo",
              workspaceUri: "file:///workspaces/beta/repo",
              isActive: true,
            },
          ],
          workspace: "repo",
          workspaceUri: "file:///workspaces/alpha/repo",
        },
        onAction,
      }),
      document.body,
    );

    const button = document.querySelector(".return-banner button");
    expect(button).toBeInstanceOf(HTMLButtonElement);

    button?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(onAction).toHaveBeenCalledWith({
      action: "activate",
      sessionId: "repo-alpha",
      workspaceUri: "file:///workspaces/alpha/repo",
    });
  });

  it("renders project thread history and forwards archive restore delete actions", () => {
    const onAction = vi.fn();

    render(
      h(App, {
        payload: {
          sessions: [],
          nativeShells: [],
          workspace: "repo-a",
          showingThreadHistory: true,
          threadHistory: {
            active: [],
            buckets: [],
            projects: [
              {
                workspaceName: "repo-a",
                workspaceUri: "file:///workspaces/repo-a",
                entries: [
                  {
                    id: "thread-a",
                    kind: "agent",
                    title: "Implement project history",
                    sessionId: "repo-a",
                    workspaceName: "repo-a",
                    workspaceUri: "file:///workspaces/repo-a",
                    createdAt: "2026-06-02T08:00:00.000Z",
                    updatedAt: "2026-06-02T09:00:00.000Z",
                    status: "completed",
                  },
                  {
                    id: "thread-b",
                    kind: "agent",
                    title: "Archived plan",
                    sessionId: "repo-a",
                    workspaceName: "repo-a",
                    workspaceUri: "file:///workspaces/repo-a",
                    createdAt: "2026-06-01T08:00:00.000Z",
                    updatedAt: "2026-06-01T09:00:00.000Z",
                    status: "completed",
                    archived: true,
                  },
                ],
              },
            ],
          },
        },
        onAction,
      }),
      document.body,
    );

    expect(document.querySelector("[data-thread-history]")).toBeInstanceOf(
      HTMLElement,
    );
    expect(
      document.querySelector("[data-thread-project]")?.getAttribute(
        "data-thread-project",
      ),
    ).toBe("file:///workspaces/repo-a");
    document
      .querySelector('[data-thread-id="thread-a"] [data-action="archiveThread"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector('[data-thread-id="thread-b"] [data-action="restoreThread"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector('[data-thread-id="thread-a"] [data-action="deleteThread"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onAction).toHaveBeenCalledWith({
      action: "archiveThread",
      threadId: "thread-a",
    });
    expect(onAction).toHaveBeenCalledWith({
      action: "restoreThread",
      threadId: "thread-b",
    });
    expect(onAction).toHaveBeenCalledWith({
      action: "deleteThread",
      threadId: "thread-a",
    });
  });
});
