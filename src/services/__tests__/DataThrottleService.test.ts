import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataThrottleService } from "../DataThrottleService";

describe("DataThrottleService", () => {
  let onBatch: ReturnType<typeof vi.fn<(batch: Array<{ paneId: string; data: string }>) => void>>;
  let service: DataThrottleService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    onBatch = vi.fn();
    service = new DataThrottleService(onBatch);
  });

  afterEach(() => {
    service.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("batches a single pane's buffered data on flush", () => {
    service.push("pane-1", "hello");
    service.push("pane-1", " world");

    service.flush();

    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith([
      { paneId: "pane-1", data: "hello world" },
    ]);
  });

  it("batches multiple panes together on flush", () => {
    service.push("pane-1", "hello");
    service.push("pane-2", "world");

    service.flush();

    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith([
      { paneId: "pane-1", data: "hello" },
      { paneId: "pane-2", data: "world" },
    ]);
  });

  it("delivers focused pane data immediately", () => {
    service.setFocusedPane("pane-1");

    service.push("pane-1", "typed");

    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith([
      { paneId: "pane-1", data: "typed" },
    ]);
  });

  it("debounces background pane data for at least 16ms", () => {
    service.setFocusedPane("pane-1");

    service.push("pane-2", "background");

    expect(onBatch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(15);
    expect(onBatch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith([
      { paneId: "pane-2", data: "background" },
    ]);
  });

  it("flushes pending data immediately", () => {
    service.push("pane-1", "a");
    service.push("pane-2", "b");

    service.flush();

    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith([
      { paneId: "pane-1", data: "a" },
      { paneId: "pane-2", data: "b" },
    ]);

    vi.advanceTimersByTime(16);
    expect(onBatch).toHaveBeenCalledTimes(1);
  });

  it("prevents further callbacks after dispose", () => {
    service.push("pane-1", "a");
    service.dispose();

    vi.advanceTimersByTime(16);
    service.push("pane-1", "b");
    service.flush();

    expect(onBatch).not.toHaveBeenCalled();
  });

  it("does nothing when flushing empty buffers", () => {
    service.flush();

    expect(onBatch).not.toHaveBeenCalled();
  });
});
