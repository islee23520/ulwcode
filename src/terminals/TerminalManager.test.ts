import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TerminalManager } from "./TerminalManager";
import type * as nodePtyTypes from "../test/mocks/node-pty";
import type * as vscodeTypes from "../test/mocks/vscode";

const nodePty = await vi.importActual<typeof nodePtyTypes>(
  "../test/mocks/node-pty",
);
const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

vi.mock("node-pty", async () => {
  const actual = await vi.importActual("../test/mocks/node-pty");
  return actual;
});

describe("TerminalManager", () => {
  let manager: TerminalManager;
  const originalPlatform = process.platform;
  const originalVsCodeShell = vscode.env.shell;
  const originalShellEnv = process.env.SHELL;
  const originalComspecEnv = process.env.COMSPEC;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TerminalManager();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
    });
    vscode.env.shell = originalVsCodeShell;
    process.env.SHELL = originalShellEnv;
    process.env.COMSPEC = originalComspecEnv;
  });

  describe("createTerminal", () => {
    it("should create a terminal with given id", () => {
      const terminal = manager.createTerminal("test-id");

      expect(terminal).toBeDefined();
      expect(terminal.id).toBe("test-id");
    });

    it("should kill existing terminal with same id", () => {
      const killSpy = vi.spyOn(manager, "killTerminal");

      manager.createTerminal("test-id");
      manager.createTerminal("test-id");

      expect(killSpy).toHaveBeenCalledWith("test-id");
    });

    it("should create terminal with command", () => {
      manager.createTerminal("test-id", "opencode");

      expect(manager.getTerminal("test-id")).toBeDefined();
    });

    it("should emit data events", () => {
      const dataHandler = vi.fn();
      manager.onData(dataHandler);

      manager.createTerminal("test-id");

      expect(dataHandler).not.toHaveBeenCalled();
    });

    it("should emit exit events", () => {
      const exitHandler = vi.fn();
      manager.onExit(exitHandler);

      manager.createTerminal("test-id");

      expect(exitHandler).not.toHaveBeenCalled();
    });

    it("should pass custom environment variables to process", () => {
      const customEnv = {
        _EXTENSION_OPENCODE_PORT: "8080",
        OPENCODE_CALLER: "vscode",
      };

      manager.createTerminal("test-id", undefined, customEnv);

      expect(nodePty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            _EXTENSION_OPENCODE_PORT: "8080",
            OPENCODE_CALLER: "vscode",
            TERM: "xterm-256color",
          }),
        }),
      );
    });

    it("should preserve existing env vars when adding custom ones", () => {
      const customEnv = {
        _EXTENSION_OPENCODE_PORT: "9090",
      };

      manager.createTerminal("test-id", undefined, customEnv);

      const spawnCall = vi.mocked(nodePty.spawn).mock.calls[0];
      const envArg = spawnCall[2].env;

      expect(envArg).toHaveProperty("TERM", "xterm-256color");
      expect(envArg).toHaveProperty("_EXTENSION_OPENCODE_PORT", "9090");
    });

    it("should track port in terminal interface", () => {
      const customEnv = {
        _EXTENSION_OPENCODE_PORT: "7070",
      };

      const terminal = manager.createTerminal(
        "test-id",
        undefined,
        customEnv,
        7070,
      );

      expect(terminal.port).toBe(7070);
    });

    it("should work without custom env (backward compatibility)", () => {
      const terminal = manager.createTerminal("test-id", "opencode");

      expect(terminal).toBeDefined();
      expect(terminal.id).toBe("test-id");
      expect(terminal.port).toBeUndefined();

      expect(nodePty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            TERM: "xterm-256color",
          }),
        }),
      );
    });

    it("should allow custom env to override TERM", () => {
      const customEnv = {
        TERM: "vt100",
        _EXTENSION_OPENCODE_PORT: "3000",
      };

      manager.createTerminal("test-id", undefined, customEnv);

      const spawnCall = vi.mocked(nodePty.spawn).mock.calls[0];
      const envArg = spawnCall[2].env;

      expect(envArg).toHaveProperty("TERM", "vt100");
    });
  });

  describe("getTerminal", () => {
    it("should return undefined for non-existent terminal", () => {
      const terminal = manager.getTerminal("non-existent");

      expect(terminal).toBeUndefined();
    });

    it("should return terminal for existing id", () => {
      manager.createTerminal("test-id");

      const terminal = manager.getTerminal("test-id");

      expect(terminal).toBeDefined();
      expect(terminal?.id).toBe("test-id");
    });
  });

  describe("writeToTerminal", () => {
    it("should write data to existing terminal", () => {
      const terminal = manager.createTerminal("test-id");
      const writeSpy = vi.spyOn(terminal.process, "write");

      manager.writeToTerminal("test-id", "test data");

      expect(writeSpy).toHaveBeenCalledWith("test data");
    });

    it("should preserve raw control bytes when writing to the terminal", () => {
      const terminal = manager.createTerminal("test-id");
      const writeSpy = vi.spyOn(terminal.process, "write");

      manager.writeToTerminal("test-id", "\x03");

      expect(writeSpy).toHaveBeenCalledWith("\x03");
    });

    it("should not throw for non-existent terminal", () => {
      expect(() => {
        manager.writeToTerminal("non-existent", "test");
      }).not.toThrow();
    });
  });

  describe("resizeTerminal", () => {
    it("should resize existing terminal", () => {
      const terminal = manager.createTerminal("test-id");
      const resizeSpy = vi.spyOn(terminal.process, "resize");

      manager.resizeTerminal("test-id", 100, 50);

      expect(resizeSpy).toHaveBeenCalledWith(100, 50);
    });

    it("should not throw for non-existent terminal", () => {
      expect(() => {
        manager.resizeTerminal("non-existent", 80, 24);
      }).not.toThrow();
    });
  });

  describe("killTerminal", () => {
    it("should kill and remove terminal", () => {
      const terminal = manager.createTerminal("test-id");
      const killSpy = vi.spyOn(terminal.process, "kill");

      manager.killTerminal("test-id");

      expect(killSpy).toHaveBeenCalled();
      expect(manager.getTerminal("test-id")).toBeUndefined();
    });

    it("should dispose event emitters", () => {
      const terminal = manager.createTerminal("test-id");
      const disposeDataSpy = vi.spyOn(terminal.onData, "dispose");
      const disposeExitSpy = vi.spyOn(terminal.onExit, "dispose");

      manager.killTerminal("test-id");

      expect(disposeDataSpy).toHaveBeenCalled();
      expect(disposeExitSpy).toHaveBeenCalled();
    });

    it("should not throw for non-existent terminal", () => {
      expect(() => {
        manager.killTerminal("non-existent");
      }).not.toThrow();
    });

    it("should ignore stale onExit from killed process when terminal is recreated with same id", () => {
      const exitHandler = vi.fn();
      manager.onExit(exitHandler);

      const oldTerminal = manager.createTerminal("test-id");
      const oldProcess = oldTerminal.process;

      manager.killTerminal("test-id");

      const newTerminal = manager.createTerminal("test-id");
      expect(manager.getTerminal("test-id")).toBe(newTerminal);

      (oldProcess as unknown as nodePtyTypes.MockPtyProcess)._simulateExit(0);

      expect(exitHandler).not.toHaveBeenCalled();
      expect(manager.getTerminal("test-id")).toBe(newTerminal);
    });

    it("should emit exit and remove mappings for the current process exit", () => {
      const globalExitHandler = vi.fn();
      const localExitHandler = vi.fn();
      manager.onExit(globalExitHandler);

      const terminal = manager.createTerminal(
        "test-id",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "instance-id",
      );
      terminal.onExit.event(localExitHandler);

      (terminal.process as unknown as nodePtyTypes.MockPtyProcess)._simulateExit(
        0,
      );

      expect(localExitHandler).toHaveBeenCalledWith("test-id");
      expect(globalExitHandler).toHaveBeenCalledWith("test-id");
      expect(manager.getTerminal("test-id")).toBeUndefined();
      expect(manager.getByInstance("instance-id")).toBeUndefined();
    });

    it("should ignore stale onData from killed process when terminal is recreated with same id", () => {
      const dataHandler = vi.fn();
      manager.onData(dataHandler);

      const oldTerminal = manager.createTerminal("test-id");
      const oldProcess = oldTerminal.process;

      manager.killTerminal("test-id");

      const newTerminal = manager.createTerminal("test-id");
      expect(manager.getTerminal("test-id")).toBe(newTerminal);

      (oldProcess as unknown as nodePtyTypes.MockPtyProcess)._simulateData(
        "stale output from old process",
      );

      expect(dataHandler).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("should kill all terminals", () => {
      const killSpy = vi.spyOn(manager, "killTerminal");

      manager.createTerminal("id1");
      manager.createTerminal("id2");
      manager.dispose();

      expect(killSpy).toHaveBeenCalledWith("id1");
      expect(killSpy).toHaveBeenCalledWith("id2");
    });
  });

  describe("instance mapping", () => {
    it("should return undefined when no terminal is mapped to an instance", () => {
      expect(manager.getByInstance("missing-instance")).toBeUndefined();
    });

    it("should kill by instance when a mapping exists", () => {
      const terminal = manager.createTerminal(
        "terminal-id",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "instance-id",
      );
      const killSpy = vi.spyOn(terminal.process, "kill");

      expect(manager.getByInstance("instance-id")).toBe(terminal);

      manager.killByInstance("instance-id");

      expect(killSpy).toHaveBeenCalled();
      expect(manager.getByInstance("instance-id")).toBeUndefined();
    });

    it("should remove only the mapping for the killed terminal", () => {
      const first = manager.createTerminal(
        "first-terminal",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "first-instance",
      );
      const second = manager.createTerminal(
        "second-terminal",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "second-instance",
      );

      manager.killTerminal("second-terminal");

      expect(manager.getByInstance("first-instance")).toBe(first);
      expect(manager.getByInstance("second-instance")).toBeUndefined();
      expect(manager.getTerminal("second-terminal")).toBeUndefined();
      expect(second.process.kill).toHaveBeenCalled();
    });

    it("should no-op when killing an unmapped instance", () => {
      expect(() => manager.killByInstance("missing-instance")).not.toThrow();
    });
  });

  describe("shell configuration", () => {
    it("should use VS Code default shell when no override", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "";
          if (key === "shellArgs") return [];
          return undefined;
        }),
        update: vi.fn(),
      } as any);

      manager.createTerminal("test-id");

      expect(manager.getTerminal("test-id")).toBeDefined();
    });

    it("should use custom shell path when configured", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "/custom/shell";
          if (key === "shellArgs") return [];
          return undefined;
        }),
        update: vi.fn(),
      } as any);

      manager.createTerminal("test-id");

      expect(manager.getTerminal("test-id")).toBeDefined();
    });

    it("should use custom shell args when configured", () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "";
          if (key === "shellArgs") return ["-l", "-i"];
          return undefined;
        }),
        update: vi.fn(),
      } as any);

      manager.createTerminal("test-id");

      expect(manager.getTerminal("test-id")).toBeDefined();
    });

    it("should use cmd.exe /c and preserve SystemRoot on Windows", () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
      });
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "cmd.exe";
          if (key === "shellArgs") return [];
          return undefined;
        }),
        update: vi.fn(),
      } as any);

      manager.createTerminal("test-id", "opencode");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "cmd.exe",
        ["/k", "opencode"],
        expect.objectContaining({
          env: expect.objectContaining({
            SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
            TERM: "xterm-256color",
          }),
        }),
      );
    });

    it("should use PowerShell -Command on Windows", () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
      });
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "pwsh.exe";
          if (key === "shellArgs") return [];
          return undefined;
        }),
        update: vi.fn(),
      } as any);

      manager.createTerminal("test-id", "opencode");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "pwsh.exe",
        ["-NoExit", "-Command", "opencode"],
        expect.any(Object),
      );
    });

    it("should detect powershell.exe (includes check) and use -NoExit -Command args on Windows", () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
      });
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "powershell.exe";
          if (key === "shellArgs") return [];
          return undefined;
        }),
        update: vi.fn(),
      } as any);

      manager.createTerminal("test-id", "opencode");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "powershell.exe",
        ["-NoExit", "-Command", "opencode"],
        expect.any(Object),
      );
    });

    it("should detect pwsh from a Unix-style path and use -NoExit -Command args on Windows", () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
      });

      const originalIncludes = String.prototype.includes;
      const originalEndsWith = String.prototype.endsWith;
      const includesSpy = vi
        .spyOn(String.prototype, "includes")
        .mockImplementation(function (this: string, searchString: string) {
          if (searchString === "powershell" || searchString === "pwsh") {
            return false;
          }
          return originalIncludes.call(this, searchString);
        });
      const endsWithSpy = vi
        .spyOn(String.prototype, "endsWith")
        .mockImplementation(function (this: string, searchString: string) {
          if (searchString === "pwsh.exe") {
            return true;
          }
          return originalEndsWith.call(this, searchString);
        });

      try {
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
          get: vi.fn((key: string) => {
            if (key === "shellPath") return "/usr/bin/pwsh";
            if (key === "shellArgs") return [];
            return undefined;
          }),
          update: vi.fn(),
        } as any);

        manager.createTerminal("pwsh-terminal", "opencode");

        expect(nodePty.spawn).toHaveBeenCalledWith(
          "/usr/bin/pwsh",
          ["-NoExit", "-Command", "opencode"],
          expect.any(Object),
        );
      } finally {
        includesSpy.mockRestore();
        endsWithSpy.mockRestore();
      }
    });

    it("should fall back to -c for non-PowerShell Windows shells", () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
      });
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "C:\\Tools\\bash.exe";
          if (key === "shellArgs") return [];
          return undefined;
        }),
        update: vi.fn(),
      } as any);

      manager.createTerminal("bash-terminal", "opencode");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "C:\\Tools\\bash.exe",
        ["-c", "opencode"],
        expect.any(Object),
      );
    });

    it("should fall back to COMSPEC on Windows when VS Code shell is empty", () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
      });
      vscode.env.shell = "";
      process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
      const configuration = {
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "";
          if (key === "shellArgs") return [];
          return undefined;
        }),
        update: vi.fn(),
      } as ReturnType<typeof vscode.workspace.getConfiguration>;
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        configuration,
      );

      manager.createTerminal("test-id", "opencode");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "C:\\Windows\\System32\\cmd.exe",
        ["/k", "opencode"],
        expect.any(Object),
      );
    });

    it("should fall back to cmd.exe on Windows when COMSPEC is empty", () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
      });
      vscode.env.shell = "";
      process.env.COMSPEC = "";
      const configuration = {
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "";
          if (key === "shellArgs") return [];
          return undefined;
        }),
        update: vi.fn(),
      } as ReturnType<typeof vscode.workspace.getConfiguration>;
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        configuration,
      );

      manager.createTerminal("test-id", "opencode");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "cmd.exe",
        ["/k", "opencode"],
        expect.any(Object),
      );
    });

    it("should fall back to the SHELL environment variable on non-Windows", () => {
      vscode.env.shell = "";
      process.env.SHELL = "/bin/zsh";
      const configuration = {
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "";
          if (key === "shellArgs") return [];
          return undefined;
        }),
        update: vi.fn(),
      } as ReturnType<typeof vscode.workspace.getConfiguration>;
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        configuration,
      );

      manager.createTerminal("test-id", "opencode");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "/bin/zsh",
        ["-c", "opencode"],
        expect.any(Object),
      );
    });

    it("should fall back to bash on non-Windows when SHELL is empty", () => {
      vscode.env.shell = "";
      process.env.SHELL = "";
      const configuration = {
        get: vi.fn((key: string) => {
          if (key === "shellPath") return "";
          if (key === "shellArgs") return [];
          return undefined;
        }),
        update: vi.fn(),
      } as ReturnType<typeof vscode.workspace.getConfiguration>;
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
        configuration,
      );

      manager.createTerminal("test-id", "opencode");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "/bin/bash",
        ["-c", "opencode"],
        expect.any(Object),
      );
    });
  });

  describe("Windows shell launch regression #37", () => {
    const setWindowsPlatform = () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
      });
    };

    const mockShellConfiguration = (shellPath: string, shellArgs: string[]) => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => {
          if (key === "shellPath") return shellPath;
          if (key === "shellArgs") return shellArgs;
          return undefined;
        }),
        update: vi.fn(),
      } as any);
    };

    it("should detect pwsh.exe from a full Windows path with spaces", () => {
      setWindowsPlatform();
      mockShellConfiguration(
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        [],
      );

      manager.createTerminal("pwsh-terminal", "opencode");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        ["-NoExit", "-Command", "opencode"],
        expect.objectContaining({
          env: expect.objectContaining({
            TERM: "xterm-256color",
          }),
        }),
      );
    });

    it("should detect cmd.exe from COMSPEC and avoid POSIX -c fallback", () => {
      setWindowsPlatform();
      vscode.env.shell = "";
      process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
      mockShellConfiguration("", []);

      manager.createTerminal("cmd-terminal", "opencode");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "C:\\Windows\\System32\\cmd.exe",
        ["/k", "opencode"],
        expect.objectContaining({
          env: expect.objectContaining({
            SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          }),
        }),
      );
      expect(vi.mocked(nodePty.spawn)).not.toHaveBeenCalledWith(
        expect.any(String),
        ["-c", "opencode"],
        expect.anything(),
      );
    });

    it("should merge env and keep Windows defaults when a custom shell is launched", () => {
      setWindowsPlatform();
      mockShellConfiguration(
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        [],
      );

      manager.createTerminal(
        "env-terminal",
        "opencode",
        {
          _EXTENSION_OPENCODE_PORT: "8123",
          OPENCODE_CALLER: "vscode",
        },
      );

      const spawnCalls = vi.mocked(nodePty.spawn).mock.calls;
      const spawnCall = spawnCalls[spawnCalls.length - 1];

      expect(spawnCall?.[2].env).toEqual(
        expect.objectContaining({
          _EXTENSION_OPENCODE_PORT: "8123",
          OPENCODE_CALLER: "vscode",
          TERM: "xterm-256color",
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
        }),
      );
    });

    it("should honor shellArgs overrides on Windows even when no command is passed", () => {
      setWindowsPlatform();
      mockShellConfiguration(
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        ["-NoLogo", "-NoProfile"],
      );

      manager.createTerminal("override-terminal");

      expect(nodePty.spawn).toHaveBeenCalledWith(
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        ["-NoLogo", "-NoProfile"],
        expect.objectContaining({
          env: expect.objectContaining({
            TERM: "xterm-256color",
          }),
        }),
      );
    });
  });
});
