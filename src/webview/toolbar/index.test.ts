// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupTmuxCommandButton,
  setupBackendToggleButton,
  setupTmuxWindowButtons,
  updateBackendToggleButtonState,
} from "./index";
import { resetVsCodeApi } from "../shared/vscode-api";

const postMessageMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resetVsCodeApi();
  document.body.innerHTML = `<button id="btn-toggle-backend"></button>`;
  vi.stubGlobal("acquireVsCodeApi", () => ({
    postMessage: postMessageMock,
    getState: vi.fn(),
    setState: vi.fn(),
  }));
});

describe("toolbar backend toggle", () => {
  it("requests backend cycle on click", () => {
    setupBackendToggleButton(() => "tmux");

    document.getElementById("btn-toggle-backend")?.click();

    expect(postMessageMock).toHaveBeenCalledWith({
      type: "cycleTerminalBackend",
    });
  });

  it("skips unavailable backends in button title", () => {
    const button = document.getElementById(
      "btn-toggle-backend",
    ) as HTMLButtonElement;

    updateBackendToggleButtonState("native", {
      native: true,
      tmux: false,
      zellij: true,
    });

    expect(button.disabled).toBe(false);
    expect(button.title).toBe("Switch to Zellij");
    expect(button.textContent).toBe("N");

    updateBackendToggleButtonState("zellij", {
      native: true,
      tmux: false,
      zellij: true,
    });

    expect(button.disabled).toBe(false);
    expect(button.title).toBe("Switch to Native Shell");
    expect(button.textContent).toBe("Z");
  });

  it("opens command dropdown with the active zellij backend", async () => {
    document.body.innerHTML = `
      <button id="btn-tmux-commands"></button>
      <div id="tmux-command-dropdown" style="display:none"></div>
      <input id="tmux-cmd-search-input" />
      <div id="tmux-command-list"></div>
    `;

    setupTmuxCommandButton(() => "repo-a", () => "zellij");
    document.getElementById("btn-tmux-commands")?.click();

    const listText = document.getElementById("tmux-command-list")?.textContent ?? "";
    expect(listText).toContain("New Tab");
    expect(listText).not.toContain("Swap Pane");
  });

  it("dispatches direct tmux session and window commands from toolbar buttons", () => {
    document.body.innerHTML = `
      <button id="btn-tmux-new-session"></button>
      <button id="btn-tmux-prev-window"></button>
      <button id="btn-tmux-new-window"></button>
      <button id="btn-tmux-next-window"></button>
    `;

    setupTmuxWindowButtons();

    document.getElementById("btn-tmux-new-session")?.click();
    document.getElementById("btn-tmux-prev-window")?.click();
    document.getElementById("btn-tmux-new-window")?.click();
    document.getElementById("btn-tmux-next-window")?.click();

    expect(postMessageMock).toHaveBeenNthCalledWith(1, {
      type: "executeTmuxCommand",
      commandId: "opencodeTui.createTmuxSession",
    });
    expect(postMessageMock).toHaveBeenNthCalledWith(2, {
      type: "executeTmuxCommand",
      commandId: "opencodeTui.tmuxPrevWindow",
    });
    expect(postMessageMock).toHaveBeenNthCalledWith(3, {
      type: "executeTmuxCommand",
      commandId: "opencodeTui.tmuxCreateWindow",
    });
    expect(postMessageMock).toHaveBeenNthCalledWith(4, {
      type: "executeTmuxCommand",
      commandId: "opencodeTui.tmuxNextWindow",
    });
  });

  it("disables direct tmux window movement outside the tmux backend", () => {
    document.body.innerHTML = `
      <button id="btn-tmux-new-session"></button>
      <button id="btn-tmux-prev-window" title="Previous tmux window"></button>
      <button id="btn-tmux-new-window" title="New tmux window"></button>
      <button id="btn-tmux-next-window" title="Next tmux window"></button>
    `;

    updateBackendToggleButtonState("native", {
      native: true,
      tmux: true,
      zellij: false,
    });

    expect(
      (document.getElementById("btn-tmux-new-session") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (document.getElementById("btn-tmux-prev-window") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (document.getElementById("btn-tmux-new-window") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (document.getElementById("btn-tmux-next-window") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
