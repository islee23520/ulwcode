// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createWheelHandler } from "./index";

const createWheelEvent = (
  init: WheelEventInit,
): WheelEvent => {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  return event;
};

describe("createWheelHandler", () => {
  describe("on Windows with no TUI mouse tracking", () => {
    const makeHandler = (overrides?: {
      scrollLines?: (count: number) => void;
    }) =>
      createWheelHandler({
        isWindows: () => true,
        getMouseTrackingMode: () => "none",
        scrollLines: overrides?.scrollLines ?? vi.fn(),
      });

    it("scrolls down on positive deltaY", () => {
      const scrollLines = vi.fn();
      const handler = makeHandler({ scrollLines });

      const event = createWheelEvent({ deltaY: 120 });
      handler(event);

      expect(scrollLines).toHaveBeenCalledWith(3);
      expect(event.defaultPrevented).toBe(true);
    });

    it("scrolls up on negative deltaY", () => {
      const scrollLines = vi.fn();
      const handler = makeHandler({ scrollLines });

      const event = createWheelEvent({ deltaY: -120 });
      handler(event);

      expect(scrollLines).toHaveBeenCalledWith(-3);
      expect(event.defaultPrevented).toBe(true);
    });

    it("calls preventDefault and stopPropagation", () => {
      const handler = makeHandler();
      const event = createWheelEvent({ deltaY: 100 });

      const stopSpy = vi.spyOn(event, "stopPropagation");

      handler(event);

      expect(event.defaultPrevented).toBe(true);
      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe("on Windows with TUI mouse tracking active", () => {
    const makeHandler = (mode: string) =>
      createWheelHandler({
        isWindows: () => true,
        getMouseTrackingMode: () => mode,
        scrollLines: vi.fn(),
      });

    it("does not intercept when mouseTrackingMode is button", () => {
      const handler = makeHandler("button");
      const event = createWheelEvent({ deltaY: 120 });

      handler(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it("does not intercept when mouseTrackingMode is any", () => {
      const handler = makeHandler("any");
      const event = createWheelEvent({ deltaY: 120 });

      handler(event);

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("guard conditions", () => {
    it("does not intercept on non-Windows platforms", () => {
      const scrollLines = vi.fn();
      const handler = createWheelHandler({
        isWindows: () => false,
        getMouseTrackingMode: () => "none",
        scrollLines,
      });

      const event = createWheelEvent({ deltaY: 120 });
      handler(event);

      expect(scrollLines).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("does not intercept when Ctrl is held", () => {
      const scrollLines = vi.fn();
      const handler = createWheelHandler({
        isWindows: () => true,
        getMouseTrackingMode: () => "none",
        scrollLines,
      });

      const event = createWheelEvent({ deltaY: 120, ctrlKey: true });
      handler(event);

      expect(scrollLines).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("does not intercept when deltaY is zero", () => {
      const scrollLines = vi.fn();
      const handler = createWheelHandler({
        isWindows: () => true,
        getMouseTrackingMode: () => "none",
        scrollLines,
      });

      const event = createWheelEvent({ deltaY: 0 });
      handler(event);

      expect(scrollLines).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("regression: Windows scroll after removing global MOUSE_ENABLE", () => {
    it("scrolls normally when no TUI has enabled mouse tracking", () => {
      const scrollLines = vi.fn();
      const handler = createWheelHandler({
        isWindows: () => true,
        getMouseTrackingMode: () => "none",
        scrollLines,
      });

      const event = createWheelEvent({ deltaY: 100 });
      handler(event);

      expect(scrollLines).toHaveBeenCalledWith(3);
      expect(event.defaultPrevented).toBe(true);
    });
  });
});
