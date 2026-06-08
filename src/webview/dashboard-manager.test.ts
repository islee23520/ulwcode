// @vitest-environment jsdom

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const tmuxCommandMock = vi.hoisted(() => ({
  isVisible: vi.fn(() => false),
  show: vi.fn(),
  hide: vi.fn(),
  handleClick: vi.fn(),
  handleKeydown: vi.fn(() => false),
}));

vi.mock("./tmux-command-dropdown", () => tmuxCommandMock);

describe("dashboard manager", () => {
  const postMessage = vi.fn();

  beforeAll(async () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({
      postMessage,
      getState: vi.fn(),
      setState: vi.fn(),
    }));
    await import("./dashboard-manager");
  });

  beforeEach(() => {
    postMessage.mockClear();
    document.body.innerHTML = `
      <div id="workspace"></div>
      <button id="toggle-scope" data-action="toggleScope"></button>
      <button id="tmux-command-trigger"></button>
      <div id="session-list"></div>
      <div id="return-banner"></div>
      <span id="return-workspace"></span>
      <div id="tmux-command-dropdown"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("ships ULW Terminal Manager document and header titles", () => {
    const html = readFileSync(join(__dirname, "dashboard.html"), "utf-8");

    expect(html).toContain("<title>ULW Terminal Manager v{{HTML_VERSION}}</title>");
    expect(html).toContain('<div class="title">ULW Terminal Manager</div>');
  });

  it("labels the project scope toggle for opened and all modes", async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "updateTmuxSessions",
          sessions: [],
          workspace: "repo-a",
          showingAll: false,
        },
      }),
    );

    expect(document.getElementById("toggle-scope")?.textContent).toBe("All");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "updateTmuxSessions",
          sessions: [],
          workspace: "repo-a",
          showingAll: true,
        },
      }),
    );

    expect(document.getElementById("toggle-scope")?.textContent).toBe("Opened");
  });

  it("posts one project activation action with workspace URI from a dashboard card", async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "updateTmuxSessions",
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
      }),
    );

    document
      .querySelector('[data-session-id="repo-a"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      action: "activate",
      sessionId: "repo-a",
      workspaceUri: "file:///workspaces/repo-a",
    });
  });
});
