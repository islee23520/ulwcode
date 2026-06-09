import { beforeEach, describe, expect, it, vi } from "vitest";
import { InputSourceSwitcher } from "./InputSourceSwitcher";

const mockExecFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn(async () => undefined));
const mockUnlink = vi.hoisted(() => vi.fn(async () => undefined));
const mockRandomUUID = vi.hoisted(() => vi.fn(() => "input-source-id"));

vi.mock("child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("fs/promises", () => ({
  writeFile: mockWriteFile,
  unlink: mockUnlink,
}));

vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));

describe("InputSourceSwitcher", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockWriteFile.mockClear();
    mockUnlink.mockClear();
    mockRandomUUID.mockClear();
  });

  it("does nothing outside macOS", async () => {
    const switcher = new InputSourceSwitcher({ platform: "linux" });

    await switcher.switchTo("korean");

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("runs the Swift input source switcher on macOS", async () => {
    mockExecFile.mockImplementation((_file, _args, callback) => {
      callback(null);
    });
    const switcher = new InputSourceSwitcher({
      platform: "darwin",
      swiftPath: "/usr/bin/swift",
      tmpDir: "/tmp",
    });

    await switcher.switchTo("english");

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/ulw-input-source-input-source-id.swift",
      expect.stringContaining("TISSelectInputSource"),
      "utf8",
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      "/usr/bin/swift",
      ["/tmp/ulw-input-source-input-source-id.swift", "english"],
      expect.any(Function),
    );
    expect(mockUnlink).toHaveBeenCalledWith(
      "/tmp/ulw-input-source-input-source-id.swift",
    );
  });

  it("deduplicates repeated target requests", async () => {
    mockExecFile.mockImplementation((_file, _args, callback) => {
      callback(null);
    });
    const switcher = new InputSourceSwitcher({
      platform: "darwin",
      tmpDir: "/tmp",
    });

    await switcher.switchTo("korean");
    await switcher.switchTo("korean");

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});
