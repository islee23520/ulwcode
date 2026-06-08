// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const postMessageMock = vi.hoisted(() => vi.fn());

vi.mock("./shared/vscode-api", () => ({
  postMessage: postMessageMock,
}));

import { handleClick, hide, show } from "./tmux-command-dropdown";

describe("tmux command dropdown", () => {
  afterEach(() => {
    hide();
    document.body.innerHTML = "";
    postMessageMock.mockReset();
  });

  it("dispatches a tmux command via postMessage when a command item is clicked", () => {
    document.body.innerHTML = `
      <div id="tmux-command-dropdown" style="display:none"></div>
      <input id="tmux-cmd-search-input" />
      <div id="tmux-command-list"></div>
    `;

    show("session-1");

    const commandItem = document.querySelector(".tmux-cmd-item");

    expect(commandItem).toBeInstanceOf(HTMLDivElement);

    const handled = handleClick(commandItem as Element);

    expect(handled).toBe(true);
    expect(postMessageMock).toHaveBeenCalledWith({
      type: "executeTmuxCommand",
      commandId: "ulw.browseTmuxSessions",
    });
  });

  it("does not expose the removed AI tool selector command", () => {
    document.body.innerHTML = `
      <div id="tmux-command-dropdown" style="display:none"></div>
      <input id="tmux-cmd-search-input" />
      <div id="tmux-command-list"></div>
    `;

    show("session-1");

    const searchInput = document.getElementById(
      "tmux-cmd-search-input",
    ) as HTMLInputElement;
    searchInput.value = "AI Tool";
    searchInput.dispatchEvent(new Event("input"));

    expect(document.querySelector(".tmux-cmd-item")?.textContent).toContain(
      "No commands found",
    );
    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it("uses zellij tab labels and hides unsupported tmux-only commands", () => {
    document.body.innerHTML = `
      <div id="tmux-command-dropdown" style="display:none"></div>
      <input id="tmux-cmd-search-input" />
      <div id="tmux-command-list"></div>
    `;

    show("session-1", "zellij");

    const listText = document.getElementById("tmux-command-list")?.textContent ?? "";
    expect(listText).toContain("New Tab");
    expect(listText).toContain("Next Tab");
    expect(listText).not.toContain("New Window");
    expect(listText).not.toContain("Swap Pane");
    expect(listText).not.toContain("Rename Window");
  });
});
