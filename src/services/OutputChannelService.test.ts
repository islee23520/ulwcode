import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { OutputChannelService } from "./OutputChannelService";

describe("OutputChannelService", () => {
  let service: OutputChannelService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "logLevel") {
          return "info";
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);
    OutputChannelService.resetInstance();
    service = OutputChannelService.getInstance();
  });

  it("should be a singleton", () => {
    const instance1 = OutputChannelService.getInstance();
    const instance2 = OutputChannelService.getInstance();
    expect(instance1).toBe(instance2);
  });

  it("should create an output channel with the correct name", () => {
    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith(
      "ULW",
      { log: true },
    );
  });

  it("should expose the underlying output channel", () => {
    const mockChannel = vi.mocked(vscode.window.createOutputChannel).mock
      .results[0].value;

    expect(service.getChannel()).toBe(mockChannel);
  });

  it("should filter debug logs when log level is info", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    service.debug("debug message");
    expect(mockChannel.debug).not.toHaveBeenCalled();
  });

  it("should call info on the output channel", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    service.info("info message");
    expect(mockChannel.info).toHaveBeenCalledWith("info message");
  });

  it("should call warn on the output channel", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    service.warn("warn message");
    expect(mockChannel.warn).toHaveBeenCalledWith("warn message");
  });

  it("should call error on the output channel with string", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    service.error("error message");
    expect(mockChannel.error).toHaveBeenCalledWith("error message");
  });

  it("should call error on the output channel with Error object", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    const error = new Error("test error");
    service.error(error);
    expect(mockChannel.error).toHaveBeenCalledWith(error);
  });

  it("should respect configuration changes for log level", () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "logLevel") {
          return "debug";
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);

    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;

    service.debug("debug enabled");
    expect(mockChannel.debug).toHaveBeenCalledWith("debug enabled");
  });

  it("should default invalid configured log levels to info", () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "logLevel") {
          return "verbose";
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);

    const mockChannel = vi.mocked(vscode.window.createOutputChannel).mock
      .results[0].value;

    service.debug("debug filtered");
    service.info("info logged");

    expect(mockChannel.debug).not.toHaveBeenCalledWith("debug filtered");
    expect(mockChannel.info).toHaveBeenCalledWith("info logged");
  });

  it("should keep errors visible for unsupported log levels", () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "logLevel") {
          return "silent";
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);

    const mockChannel = vi.mocked(vscode.window.createOutputChannel).mock
      .results[0].value;

    service.error("filtered error");

    expect(mockChannel.error).toHaveBeenCalledWith("filtered error");
  });

  it("should skip error writes when shouldLog rejects them", () => {
    const mockChannel = vi.mocked(vscode.window.createOutputChannel).mock
      .results[0].value;
    Reflect.set(service, "shouldLog", () => false);

    service.error("filtered by override");

    expect(mockChannel.error).not.toHaveBeenCalledWith("filtered by override");
  });

  it("should dispose the output channel", () => {
    const mockChannel = (vscode.window.createOutputChannel as any).mock
      .results[0].value;
    service.dispose();
    expect(mockChannel.dispose).toHaveBeenCalled();
  });
});
