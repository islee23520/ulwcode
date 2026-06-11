// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createKeyboardHandler } from "./keyboard";

const createKeyboardEvent = (
  init: KeyboardEventInit & { code: string },
): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  Object.defineProperty(event, "code", {
    value: init.code,
  });

  return event;
};

const expectKeyboardHandling = (
  keyboard: ReturnType<typeof createKeyboardHandler>,
  init: KeyboardEventInit & { code: string },
  expectedAllowed: boolean,
  expectedDefaultPrevented: boolean,
) => {
  const event = createKeyboardEvent(init);

  expect(keyboard.handler(event)).toBe(expectedAllowed);
  expect(event.defaultPrevented).toBe(expectedDefaultPrevented);
};

describe("createKeyboardHandler", () => {
  describe("on macOS", () => {
    const makeKeyboard = () => createKeyboardHandler({ isMac: true });

    it("passes Cmd+letter chords through to VS Code", () => {
      expectKeyboardHandling(makeKeyboard(), {
        metaKey: true,
        key: "b",
        code: "KeyB",
      }, false, false);
    });

    it("passes Cmd+Shift+letter chords through to VS Code", () => {
      expectKeyboardHandling(makeKeyboard(), {
        metaKey: true,
        shiftKey: true,
        key: "P",
        code: "KeyP",
      }, false, false);
    });

    it("passes Cmd+P through while keeping Ctrl+P in the terminal when shell keybindings are enabled", () => {
      const keyboard = createKeyboardHandler({
        isMac: true,
        sendKeybindingsToShell: true,
      });
      const cmdEvent = createKeyboardEvent({
        metaKey: true,
        key: "p",
        code: "KeyP",
      });
      const stopCmdPropagation = vi.spyOn(cmdEvent, "stopPropagation");

      expect(keyboard.handler(cmdEvent)).toBe(false);
      expect(cmdEvent.defaultPrevented).toBe(false);
      expect(stopCmdPropagation).not.toHaveBeenCalled();

      expectKeyboardHandling(keyboard, {
        ctrlKey: true,
        key: "p",
        code: "KeyP",
      }, true, true);
    });

    it("passes Cmd+digit chords through to VS Code", () => {
      expectKeyboardHandling(makeKeyboard(), {
        metaKey: true,
        key: "1",
        code: "Digit1",
      }, false, false);
    });

    it("requests host paste on Cmd+V", () => {
      const requestPaste = vi.fn();
      expectKeyboardHandling(createKeyboardHandler({ isMac: true, requestPaste }), {
        metaKey: true,
        key: "v",
        code: "KeyV",
      }, false, true);
      expect(requestPaste).toHaveBeenCalledTimes(1);
    });

    it("requests host paste on Cmd+Shift+V", () => {
      const requestPaste = vi.fn();
      expectKeyboardHandling(createKeyboardHandler({ isMac: true, requestPaste }), {
        metaKey: true,
        shiftKey: true,
        key: "V",
        code: "KeyV",
      }, false, true);
      expect(requestPaste).toHaveBeenCalledTimes(1);
    });

    it("keeps Ctrl+letter chords with xterm for terminal control characters", () => {
      expectKeyboardHandling(makeKeyboard(), {
        ctrlKey: true,
        key: "c",
        code: "KeyC",
      }, true, true);
    });

    it("copies terminal selection on Cmd+C", () => {
      const copySelection = vi.fn();
      expectKeyboardHandling(createKeyboardHandler({
        isMac: true,
        hasSelection: () => true,
        copySelection,
      }), {
        metaKey: true,
        key: "c",
        code: "KeyC",
      }, false, true);
      expect(copySelection).toHaveBeenCalledTimes(1);
    });
  });

  describe("on Windows/Linux", () => {
    const makeKeyboard = () => createKeyboardHandler({ isMac: false });

    it("passes Ctrl+letter chords through to VS Code", () => {
      expectKeyboardHandling(makeKeyboard(), {
        ctrlKey: true,
        key: "b",
        code: "KeyB",
      }, false, false);
    });

    it("passes Ctrl+C through so the terminal can receive the control byte", () => {
      expectKeyboardHandling(makeKeyboard(), {
        ctrlKey: true,
        key: "c",
        code: "KeyC",
      }, true, true);
    });

    it("passes Ctrl+Shift+letter chords through to VS Code", () => {
      expectKeyboardHandling(makeKeyboard(), {
        ctrlKey: true,
        shiftKey: true,
        key: "P",
        code: "KeyP",
      }, false, false);
    });

    it("passes Ctrl+digit chords through to VS Code", () => {
      expectKeyboardHandling(makeKeyboard(), {
        ctrlKey: true,
        key: "1",
        code: "Digit1",
      }, false, false);
    });

    it("passes Ctrl+C through to the terminal as a control byte", () => {
      expectKeyboardHandling(makeKeyboard(), {
        ctrlKey: true,
        key: "c",
        code: "KeyC",
      }, true, true);
    });

    it("copies terminal selection on Ctrl+C", () => {
      const copySelection = vi.fn();
      expectKeyboardHandling(createKeyboardHandler({
        isMac: false,
        hasSelection: () => true,
        copySelection,
      }), {
        ctrlKey: true,
        key: "c",
        code: "KeyC",
      }, false, true);
      expect(copySelection).toHaveBeenCalledTimes(1);
    });

    it("requests host paste on Ctrl+V", () => {
      const requestPaste = vi.fn();
      expectKeyboardHandling(createKeyboardHandler({ isMac: false, requestPaste }), {
        ctrlKey: true,
        key: "v",
        code: "KeyV",
      }, false, true);
      expect(requestPaste).toHaveBeenCalledTimes(1);
    });

    it("requests host paste for Ctrl+V even when sendKeybindingsToShell is enabled", () => {
      const requestPaste = vi.fn();
      expectKeyboardHandling(createKeyboardHandler({
        isMac: false,
        requestPaste,
        sendKeybindingsToShell: true,
      }), {
        ctrlKey: true,
        key: "v",
        code: "KeyV",
      }, false, true);
      expect(requestPaste).toHaveBeenCalledTimes(1);
    });

    it("keeps Ctrl+P with xterm when sendKeybindingsToShell is enabled", () => {
      expectKeyboardHandling(createKeyboardHandler({
        isMac: false,
        sendKeybindingsToShell: true,
      }), {
        ctrlKey: true,
        key: "p",
        code: "KeyP",
      }, true, true);
    });

    it("lets VS Code handle Ctrl+P when sendKeybindingsToShell is disabled", () => {
      expectKeyboardHandling(createKeyboardHandler({
        isMac: false,
        sendKeybindingsToShell: false,
      }), {
        ctrlKey: true,
        key: "p",
        code: "KeyP",
      }, false, false);
    });

    it("requests host paste on Ctrl+Shift+V", () => {
      const requestPaste = vi.fn();
      expectKeyboardHandling(createKeyboardHandler({ isMac: false, requestPaste }), {
        ctrlKey: true,
        shiftKey: true,
        key: "V",
        code: "KeyV",
      }, false, true);
      expect(requestPaste).toHaveBeenCalledTimes(1);
    });

    it("keeps stray Cmd+letter chords with xterm", () => {
      expectKeyboardHandling(makeKeyboard(), {
        metaKey: true,
        key: "b",
        code: "KeyB",
      }, true, true);
    });
  });

  describe("platform agnostic", () => {
    it("sends readline word-movement sequences for Alt+Left and Alt+Right", () => {
      const sendInput = vi.fn();
      const keyboard = createKeyboardHandler({ isMac: true, sendInput });

      const leftEvent = createKeyboardEvent({
        altKey: true,
        key: "ArrowLeft",
        code: "ArrowLeft",
      });
      const rightEvent = createKeyboardEvent({
        altKey: true,
        key: "ArrowRight",
        code: "ArrowRight",
      });

      expect(keyboard.handler(leftEvent)).toBe(false);
      expect(leftEvent.defaultPrevented).toBe(true);
      expect(keyboard.handler(rightEvent)).toBe(false);
      expect(rightEvent.defaultPrevented).toBe(true);
      expect(sendInput).toHaveBeenNthCalledWith(1, "\x1bb");
      expect(sendInput).toHaveBeenNthCalledWith(2, "\x1bf");
    });

    it("does not intercept Alt+Arrow word movement when sendInput is missing", () => {
      const keyboard = createKeyboardHandler({ isMac: true });

      expectKeyboardHandling(keyboard, {
        altKey: true,
        key: "ArrowLeft",
        code: "ArrowLeft",
      }, true, false);
    });

    it("does not intercept plain letter keys", () => {
      const keyboard = createKeyboardHandler({ isMac: true });
      expectKeyboardHandling(keyboard, {
        key: "l",
        code: "KeyL",
      }, true, false);
    });

    it("does not intercept Alt-modified chords", () => {
      const keyboard = createKeyboardHandler({ isMac: true });
      expectKeyboardHandling(keyboard, {
        ctrlKey: true,
        altKey: true,
        key: "m",
        code: "KeyM",
      }, true, false);
    });

    it("keeps Cmd+Ctrl combos with xterm on either platform", () => {
      const makeEvent = () =>
        createKeyboardEvent({
          metaKey: true,
          ctrlKey: true,
          key: "p",
          code: "KeyP",
        });

      const macKeyboard = createKeyboardHandler({ isMac: true });
      const macEvent = makeEvent();
      expect(macKeyboard.handler(macEvent)).toBe(true);
      expect(macEvent.defaultPrevented).toBe(true);

      const winKeyboard = createKeyboardHandler({ isMac: false });
      const winEvent = makeEvent();
      expect(winKeyboard.handler(winEvent)).toBe(true);
      expect(winEvent.defaultPrevented).toBe(true);
    });
  });

  describe("Shift+Enter handling", () => {
    it("sends \\n through sendInput on Shift+Enter", () => {
      const sendInput = vi.fn();
      const keyboard = createKeyboardHandler({ isMac: true, sendInput });

      const event = createKeyboardEvent({
        key: "Enter",
        code: "Enter",
        shiftKey: true,
      });

      expect(keyboard.handler(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(sendInput).toHaveBeenCalledWith("\n");
    });

    it("does not intercept Shift+Enter when Ctrl is held", () => {
      const sendInput = vi.fn();
      const keyboard = createKeyboardHandler({ isMac: true, sendInput });

      const event = createKeyboardEvent({
        key: "Enter",
        code: "Enter",
        shiftKey: true,
        ctrlKey: true,
      });

      expect(keyboard.handler(event)).toBe(true);
      expect(sendInput).not.toHaveBeenCalled();
    });

    it("does not intercept Shift+Enter when Alt is held", () => {
      const sendInput = vi.fn();
      const keyboard = createKeyboardHandler({ isMac: true, sendInput });

      const event = createKeyboardEvent({
        key: "Enter",
        code: "Enter",
        shiftKey: true,
        altKey: true,
      });

      expect(keyboard.handler(event)).toBe(true);
      expect(sendInput).not.toHaveBeenCalled();
    });

    it("does not intercept Shift+Enter when Meta is held", () => {
      const sendInput = vi.fn();
      const keyboard = createKeyboardHandler({ isMac: true, sendInput });

      const event = createKeyboardEvent({
        key: "Enter",
        code: "Enter",
        shiftKey: true,
        metaKey: true,
      });

      expect(keyboard.handler(event)).toBe(true);
      expect(sendInput).not.toHaveBeenCalled();
    });

    it("ignores Shift+Enter on keyup", () => {
      const sendInput = vi.fn();
      const keyboard = createKeyboardHandler({ isMac: true, sendInput });

      const event = new KeyboardEvent("keyup", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      expect(keyboard.handler(event)).toBe(true);
      expect(sendInput).not.toHaveBeenCalled();
    });

    it("does not intercept Shift+Enter when sendInput is not provided", () => {
      const keyboard = createKeyboardHandler({ isMac: true });

      const event = createKeyboardEvent({
        key: "Enter",
        code: "Enter",
        shiftKey: true,
      });

      expect(keyboard.handler(event)).toBe(true);
    });

    it("sends \\n on Windows/Linux Shift+Enter", () => {
      const sendInput = vi.fn();
      const keyboard = createKeyboardHandler({ isMac: false, sendInput });

      const event = createKeyboardEvent({
        key: "Enter",
        code: "Enter",
        shiftKey: true,
      });

      expect(keyboard.handler(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(sendInput).toHaveBeenCalledWith("\n");
    });
  });

  describe("Ctrl+Enter handling", () => {
    it("sends a modified Enter sequence on macOS", () => {
      const sendInput = vi.fn();
      const keyboard = createKeyboardHandler({ isMac: true, sendInput });

      const event = createKeyboardEvent({
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
      });

      expect(keyboard.handler(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(sendInput).toHaveBeenCalledWith("\x1b[13;5u");
    });

    it("sends a modified Enter sequence on Windows/Linux", () => {
      const sendInput = vi.fn();
      const keyboard = createKeyboardHandler({ isMac: false, sendInput });

      const event = createKeyboardEvent({
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
      });

      expect(keyboard.handler(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(sendInput).toHaveBeenCalledWith("\x1b[13;5u");
    });

    it("does not intercept Ctrl+Enter when sendInput is missing", () => {
      const keyboard = createKeyboardHandler({ isMac: true });

      const event = createKeyboardEvent({
        key: "Enter",
        code: "Enter",
        ctrlKey: true,
      });

      expect(keyboard.handler(event)).toBe(true);
    });
  });
});
