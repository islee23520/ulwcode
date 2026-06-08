// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMessageHandler } from "./index";

const mockHandlePasteWithImageSupport = vi.hoisted(() => vi.fn());

vi.mock("../clipboard", () => ({
  handlePasteWithImageSupport: mockHandlePasteWithImageSupport,
}));

describe("createMessageHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes requestPaste messages through image-aware paste handling", () => {
    const handler = createMessageHandler({
      onActiveSession: vi.fn(),
      onToggleTmuxCommandToolbar: vi.fn(),
      onShowTmuxPrompt: vi.fn(),
      onPlatformInfo: vi.fn(),
    });

    handler.handleEvent(
      new MessageEvent("message", { data: { type: "requestPaste" } }),
    );

    expect(mockHandlePasteWithImageSupport).toHaveBeenCalledTimes(1);
  });

  it("toggles tmux window controls from terminalConfig", () => {
    document.body.innerHTML = `<div data-tmux-window-controls></div>`;
    const controls = document.querySelector(
      "[data-tmux-window-controls]",
    ) as HTMLElement;
    const handler = createMessageHandler({
      onActiveSession: vi.fn(),
      onToggleTmuxCommandToolbar: vi.fn(),
      onShowTmuxPrompt: vi.fn(),
      onPlatformInfo: vi.fn(),
    });

    handler.handleEvent(
      new MessageEvent("message", {
        data: {
          type: "terminalConfig",
          fontSize: 14,
          fontFamily: "monospace",
          cursorBlink: true,
          cursorStyle: "block",
          scrollback: 10000,
          showTmuxWindowControls: false,
        },
      }),
    );

    expect(controls.classList.contains("hidden")).toBe(true);

    handler.handleEvent(
      new MessageEvent("message", {
        data: {
          type: "terminalConfig",
          fontSize: 14,
          fontFamily: "monospace",
          cursorBlink: true,
          cursorStyle: "block",
          scrollback: 10000,
          showTmuxWindowControls: true,
        },
      }),
    );

    expect(controls.classList.contains("hidden")).toBe(false);
  });
});
