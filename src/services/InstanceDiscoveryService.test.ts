import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  InstanceDiscoveryService,
  type OpenCodeInstance,
} from "./InstanceDiscoveryService";
import { OpenCodeApiClient } from "./OpenCodeApiClient";
import { InstanceStore, type InstanceRecord } from "./InstanceStore";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

type DiscoveryHarness = {
  getPlatform(): NodeJS.Platform;
  scanProcesses(): Promise<OpenCodeInstance[]>;
  healthCheck(port: number): Promise<boolean>;
  getWorkspacePath(port: number): Promise<string | undefined>;
  spawnOpenCode(): Promise<OpenCodeInstance | undefined>;
  scanWindowsProcesses(): Promise<Array<{ pid: number; commandLine: string }>>;
  scanUnixProcesses(): Promise<Array<{ pid: number; commandLine: string }>>;
  runCommand(file: string, args: string[]): Promise<string>;
  extractPortFromCommand(commandLine: string): number | undefined;
  filterByWorkspace(instances: OpenCodeInstance[]): OpenCodeInstance[];
  waitForSpawnReadiness(port: number): Promise<boolean>;
  parseCommand(commandLine: string): { file: string; args: string[] } | undefined;
  sleep(ms: number): Promise<void>;
  normalizePath(pathValue: string): string;
  generateEphemeralPort(): number;
  isEphemeralPort(port: number): boolean;
};

type MutableWorkspace = typeof vscode.workspace & {
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined;
};

const asHarness = (target: InstanceDiscoveryService): DiscoveryHarness =>
  target as unknown as DiscoveryHarness;

const setWorkspaceFolders = (
  folders: Array<{ uri: { fsPath: string } }> | undefined,
): void => {
  (vscode.workspace as unknown as MutableWorkspace).workspaceFolders =
    folders?.map((folder, index) => ({
      uri: folder.uri as unknown as vscode.Uri,
      name: `workspace-${index}`,
      index,
    }));
};

const createChildProcess = (
  pid: number | undefined,
  behavior: "stay-running" | "error" | "exit-zero" | "exit-nonzero" =
    "stay-running",
): ChildProcess => {
  const listeners = new Map<string, Array<(code?: number) => void>>();
  const child = {
    pid,
    on: vi.fn((event: string, handler: (code?: number) => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(handler);
      listeners.set(event, existing);

      if (event === "error" && behavior === "error") {
        queueMicrotask(() => handler());
      }

      if (event === "exit") {
        if (behavior === "exit-zero") {
          queueMicrotask(() => handler(0));
        }

        if (behavior === "exit-nonzero") {
          queueMicrotask(() => handler(1));
        }
      }

      return child;
    }),
  };

  return child as unknown as ChildProcess;
};

describe("InstanceDiscoveryService", () => {
  let service: InstanceDiscoveryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InstanceDiscoveryService();
    (vscode.workspace as any).workspaceFolders = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockExecOutput(stdout: string): void {
    vi.mocked(execFile).mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1] as ExecFileCallback;
      callback?.(null, stdout, "");
      return {} as any;
    });
  }

  it("Test 1: Scanning returns potential OpenCode processes", async () => {
    const windowsProcessList = JSON.stringify([
      {
        ProcessId: 101,
        Name: "opencode.exe",
        CommandLine: "opencode --port 17001",
      },
      {
        ProcessId: 202,
        Name: "node.exe",
        CommandLine: "node server.js",
      },
    ]);

    mockExecOutput(windowsProcessList);
    vi.spyOn(service as any, "getPlatform").mockReturnValue("win32");

    const instances = await (service as any).scanProcesses();

    expect(instances).toEqual([
      {
        pid: 101,
        port: 17001,
      },
    ]);
  });

  it("Test 2: Health check filters non-OpenCode processes", async () => {
    vi.spyOn(service as any, "scanProcesses").mockResolvedValue([
      { pid: 111, port: 18001 },
      { pid: 222, port: 18002 },
    ]);
    vi.spyOn(service as any, "healthCheck")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    vi.spyOn(service as any, "getWorkspacePath").mockResolvedValue(undefined);

    const instances = await service.discoverInstances();

    expect(instances).toEqual([
      { pid: 111, port: 18001, workspacePath: undefined },
    ]);
  });

  it("Test 3: Workspace matching validates correct instance", async () => {
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: "/workspace/current" } },
    ];

    vi.spyOn(service as any, "scanProcesses").mockResolvedValue([
      { pid: 1, port: 19001 },
      { pid: 2, port: 19002 },
    ]);
    vi.spyOn(service as any, "healthCheck").mockResolvedValue(true);
    vi.spyOn(service as any, "getWorkspacePath")
      .mockResolvedValueOnce("/workspace/current")
      .mockResolvedValueOnce("/workspace/other");

    const instances = await service.discoverInstances();

    expect(instances).toEqual([
      {
        pid: 1,
        port: 19001,
        workspacePath: "/workspace/current",
      },
    ]);
  });

  it("Test 4: Auto-spawn creates new instance when enabled", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "enableAutoSpawn") {
          return true;
        }
        if (key === "defaultAiTool") {
          return "opencode";
        }
        if (key === "aiTools") {
          return [];
        }
        return defaultValue;
      }),
      update: vi.fn(),
    } as any);

    service = new InstanceDiscoveryService();

    vi.spyOn(service as any, "scanProcesses").mockResolvedValue([]);
    vi.spyOn(service as any, "spawnOpenCode").mockResolvedValue({
      pid: 300,
      port: 20001,
      workspacePath: "/workspace/new",
    });

    const instances = await service.discoverInstances();

    expect(instances).toEqual([
      {
        pid: 300,
        port: 20001,
        workspacePath: "/workspace/new",
      },
    ]);
  });

  it("Test 5: Platform detection works correctly", async () => {
    mockExecOutput("[]");

    vi.spyOn(service as any, "getPlatform").mockReturnValue("win32");
    await (service as any).scanProcesses();

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "powershell.exe",
      expect.any(Array),
      expect.any(Function),
    );

    vi.mocked(execFile).mockClear();

    vi.spyOn(service as any, "getPlatform").mockReturnValue("linux");
    await (service as any).scanProcesses();

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      "ps",
      expect.any(Array),
      expect.any(Function),
    );
  });

  it("Test 6: Proper disposal of resources", async () => {
    vi.spyOn(service as any, "scanProcesses").mockResolvedValue([
      { pid: 11, port: 21001 },
    ]);
    vi.spyOn(service as any, "healthCheck").mockResolvedValue(true);
    vi.spyOn(service as any, "getWorkspacePath").mockResolvedValue(
      "/workspace/a",
    );

    await service.discoverInstances();
    service.dispose();

    const scanSpy = vi.spyOn(service as any, "scanProcesses");
    scanSpy.mockClear();
    const instances = await service.discoverInstances();

    expect(instances).toEqual([]);
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it("uses Unix process scanning and port extraction patterns", async () => {
    mockExecOutput(
      [
        "777 opencode --http-port 22001",
        "888 opencode --port 22002",
        "999 opencode _EXTENSION_OPENCODE_PORT=22003",
      ].join("\n"),
    );

    vi.spyOn(service as any, "getPlatform").mockReturnValue("linux");

    const instances = await (service as any).scanProcesses();

    expect(instances).toEqual([
      { pid: 777, port: 22001 },
      { pid: 888, port: 22002 },
      { pid: 999, port: 22003 },
    ]);
  });

  it("returns false when OpenCode health check fails", async () => {
    vi.spyOn(OpenCodeApiClient.prototype, "healthCheck").mockResolvedValue(
      false,
    );

    const isHealthy = await (service as any).healthCheck(23001);

    expect(isHealthy).toBe(false);
  });

  it("reads workspace path from health payload", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workspacePath: "/workspace/api" }),
    } as any);

    const workspacePath = await (service as any).getWorkspacePath(24001);

    expect(workspacePath).toBe("/workspace/api");
  });

  it("handles workspace path fetch errors safely", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("connection failed"));

    const workspacePath = await (service as any).getWorkspacePath(24002);

    expect(workspacePath).toBeUndefined();
  });

  it("does not auto-spawn when feature is disabled", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "enableAutoSpawn") {
          return false;
        }
        if (key === "defaultAiTool") {
          return "opencode";
        }
        if (key === "aiTools") {
          return [];
        }
        return defaultValue;
      }),
      update: vi.fn(),
    } as any);

    service = new InstanceDiscoveryService();

    vi.spyOn(service as any, "scanProcesses").mockResolvedValue([]);
    const spawnSpy = vi
      .spyOn(service as any, "spawnOpenCode")
      .mockResolvedValue(undefined);

    const instances = await service.discoverInstances();

    expect(instances).toEqual([]);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("returns spawned instance with pid and ephemeral port", async () => {
    vi.mocked(execFile).mockImplementation((...args: any[]) => {
      const callback = args[args.length - 1];
      if (typeof callback === "function") {
        callback(null, "", "");
      }

      const child = {
        pid: 4321,
        on: vi.fn((event: string, handler: (code?: number) => void) => {
          if (event === "exit") {
            queueMicrotask(() => handler(0));
          }
          return child;
        }),
      };

      return child as any;
    });
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: "/workspace/spawn" } },
    ];
    vi.spyOn(service as any, "waitForSpawnReadiness").mockResolvedValue(true);
    vi.spyOn(service as any, "getWorkspacePath").mockResolvedValue(
      "/workspace/spawn",
    );

    const spawned = await (service as any).spawnOpenCode();

    expect(spawned.pid).toBe(4321);
    expect(spawned.workspacePath).toBe("/workspace/spawn");
    expect(spawned.port).toBeGreaterThanOrEqual(16384);
    expect(spawned.port).toBeLessThanOrEqual(65535);
  });

  it("parses quoted command and args for auto-spawn", () => {
    const parsed = (service as any).parseCommand(
      '"/path with spaces/opencode" -c --profile "dev mode"',
    );

    expect(parsed).toEqual({
      file: "/path with spaces/opencode",
      args: ["-c", "--profile", "dev mode"],
    });
  });

  it("returns undefined for malformed quoted command", () => {
    const parsed = (service as any).parseCommand('"/path with spaces/opencode');

    expect(parsed).toBeUndefined();
  });

  it("preserves backslashes in quoted Windows executable path", () => {
    const parsed = (service as any).parseCommand(
      '"C:\\Program Files\\OpenCode\\opencode.exe" -c --mode test',
    );

    expect(parsed).toEqual({
      file: "C:\\Program Files\\OpenCode\\opencode.exe",
      args: ["-c", "--mode", "test"],
    });
  });

  it("returns no instances when process scanning is disabled", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "enableProcessScan") {
          return false;
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);

    service = new InstanceDiscoveryService();
    const scanSpy = vi.spyOn(asHarness(service), "scanProcesses");

    await expect(service.discoverInstances()).resolves.toEqual([]);
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it("stops discovery when disposed while processing scanned candidates", async () => {
    vi.spyOn(asHarness(service), "scanProcesses").mockResolvedValue([
      { pid: 1, port: 25001 },
      { pid: 2, port: 25002 },
    ]);
    vi.spyOn(asHarness(service), "healthCheck").mockImplementation(
      async (port) => {
        if (port === 25001) {
          service.dispose();
        }

        return true;
      },
    );
    vi.spyOn(asHarness(service), "getWorkspacePath").mockResolvedValue(
      undefined,
    );

    await expect(service.discoverInstances()).resolves.toEqual([]);
  });

  it("continues discovery after a candidate health check throws", async () => {
    vi.spyOn(asHarness(service), "scanProcesses").mockResolvedValue([
      { pid: 1, port: 26001 },
      { pid: 2, port: 26002 },
    ]);
    vi.spyOn(asHarness(service), "healthCheck")
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(true);
    vi.spyOn(asHarness(service), "getWorkspacePath").mockResolvedValue(
      undefined,
    );

    await expect(service.discoverInstances()).resolves.toEqual([
      { pid: 2, port: 26002, workspacePath: undefined },
    ]);
  });

  it("logs non-Error health failures and returns empty when auto-spawn finds nothing", async () => {
    vi.spyOn(asHarness(service), "scanProcesses").mockResolvedValue([
      { pid: 1, port: 26003 },
    ]);
    vi.spyOn(asHarness(service), "healthCheck").mockRejectedValue("offline");
    vi.spyOn(asHarness(service), "spawnOpenCode").mockResolvedValue(undefined);

    await expect(service.discoverInstances()).resolves.toEqual([]);
  });

  it("syncs discovered instances to the store and removes stale discovered records", async () => {
    const store = new InstanceStore();
    const stale: InstanceRecord = {
      config: { id: "discovered-27000", preferredPort: 27000 },
      runtime: { port: 27000, pid: 7 },
      state: "connected",
    };
    const manual: InstanceRecord = {
      config: { id: "manual", preferredPort: 27001 },
      runtime: { port: 27001, pid: 8 },
      state: "connected",
    };
    store.upsert(stale);
    store.upsert(manual);

    service = new InstanceDiscoveryService(store);
    vi.spyOn(asHarness(service), "scanProcesses").mockResolvedValue([
      { pid: 9, port: 27002 },
    ]);
    vi.spyOn(asHarness(service), "healthCheck").mockResolvedValue(true);
    vi.spyOn(asHarness(service), "getWorkspacePath").mockResolvedValue(
      "/workspace/synced",
    );

    await expect(service.discoverInstances()).resolves.toEqual([
      { pid: 9, port: 27002, workspacePath: "/workspace/synced" },
    ]);

    expect(store.get("discovered-27000")).toBeUndefined();
    expect(store.get("manual")).toEqual(manual);
    expect(store.get("discovered-27002")).toMatchObject({
      config: {
        id: "discovered-27002",
        label: "Port 27002",
        preferredPort: 27002,
        workspaceUri: "/workspace/synced",
      },
      runtime: { port: 27002, pid: 9 },
      state: "disconnected",
    });
  });

  it("clears stale discovered store entries when no instances are found", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "enableAutoSpawn") {
          return false;
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);
    const store = new InstanceStore();
    store.upsert({
      config: { id: "discovered-28000", preferredPort: 28000 },
      runtime: { port: 28000, pid: 10 },
      state: "connected",
    });
    service = new InstanceDiscoveryService(store);
    vi.spyOn(asHarness(service), "scanProcesses").mockResolvedValue([]);

    await expect(service.discoverInstances()).resolves.toEqual([]);

    expect(store.getAll()).toEqual([]);
  });

  it("deduplicates scanned ports and skips commands without ephemeral ports", async () => {
    mockExecOutput(
      [
        "100 opencode --port 1024",
        "101 opencode without-port",
        "102 opencode --port 29001",
        "102 opencode --port 29001",
        "103 opencode http://localhost:29002",
      ].join("\n"),
    );
    vi.spyOn(asHarness(service), "getPlatform").mockReturnValue("linux");

    await expect(asHarness(service).scanProcesses()).resolves.toEqual([
      { pid: 102, port: 29001 },
      { pid: 103, port: 29002 },
    ]);
  });

  it("returns undefined workspace path for non-ok health responses and supports cwd/workspace fallbacks", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: false } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cwd: "/workspace/cwd" }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ workspace: "/workspace/workspace" }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(asHarness(service).getWorkspacePath(30001)).resolves.toBeUndefined();
    await expect(asHarness(service).getWorkspacePath(30002)).resolves.toBe(
      "/workspace/cwd",
    );
    await expect(asHarness(service).getWorkspacePath(30003)).resolves.toBe(
      "/workspace/workspace",
    );
  });

  it("logs non-Error workspace path read failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("network down"));

    await expect(asHarness(service).getWorkspacePath(30005)).resolves.toBeUndefined();
  });

  it("aborts in-flight workspace reads on dispose", async () => {
    let capturedSignal: AbortSignal | undefined;
    const pendingFetch = new Promise<Response>(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        capturedSignal = init?.signal ?? undefined;
        return pendingFetch;
      }),
    );

    const workspacePromise = asHarness(service).getWorkspacePath(30004);
    await Promise.resolve();
    service.dispose();

    expect(capturedSignal?.aborted).toBe(true);
    void workspacePromise;
  });

  it("covers Windows process scan empty, singleton, malformed, and optional fields", async () => {
    vi.spyOn(asHarness(service), "runCommand")
      .mockResolvedValueOnce("   ")
      .mockResolvedValueOnce(
        JSON.stringify({
          ProcessId: 31001,
          Name: "opencode.exe",
          CommandLine: "opencode --port 31002",
        }),
      )
      .mockResolvedValueOnce("not-json")
      .mockResolvedValueOnce(
        JSON.stringify([
          {},
          { ProcessId: 0, Name: "opencode.exe", CommandLine: "opencode" },
          { ProcessId: 31003 },
          { ProcessId: 31004, Name: "node.exe", CommandLine: "node" },
        ]),
      );

    await expect(asHarness(service).scanWindowsProcesses()).resolves.toEqual([]);
    await expect(asHarness(service).scanWindowsProcesses()).resolves.toEqual([
      { pid: 31001, commandLine: "opencode.exe opencode --port 31002" },
    ]);
    await expect(asHarness(service).scanWindowsProcesses()).resolves.toEqual([]);
    await expect(asHarness(service).scanWindowsProcesses()).resolves.toEqual([]);
  });

  it("logs non-Error Windows process JSON parse failures", async () => {
    vi.spyOn(asHarness(service), "runCommand").mockResolvedValue("[]");
    vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      throw "parse failed";
    });

    await expect(asHarness(service).scanWindowsProcesses()).resolves.toEqual([]);
  });

  it("covers Unix scan empty output, malformed lines, and non-opencode filtering", async () => {
    vi.spyOn(asHarness(service), "runCommand")
      .mockResolvedValueOnce("\n")
      .mockResolvedValueOnce(
        [
          "not-a-pid opencode --port 32001",
          "32002 node server.js",
          "32003 opencode --port 32003",
          "",
        ].join("\n"),
      );

    await expect(asHarness(service).scanUnixProcesses()).resolves.toEqual([]);
    await expect(asHarness(service).scanUnixProcesses()).resolves.toEqual([
      { pid: 32003, commandLine: "opencode --port 32003" },
    ]);
  });

  it("runCommand resolves empty output on exec errors", async () => {
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as ExecFileCallback;
      callback(new Error("failed"), "ignored", "");
      return createChildProcess(undefined);
    });

    await expect(asHarness(service).runCommand("missing", [])).resolves.toBe("");
  });

  it("extracts only supported ephemeral port patterns", () => {
    const harness = asHarness(service);

    expect(harness.extractPortFromCommand("opencode --port=33001")).toBe(33001);
    expect(harness.extractPortFromCommand("opencode --http-port 33002")).toBe(
      33002,
    );
    expect(
      harness.extractPortFromCommand("_EXTENSION_OPENCODE_PORT 33003"),
    ).toBe(33003);
    expect(harness.extractPortFromCommand("http://localhost:33004" )).toBe(
      33004,
    );
    expect(harness.extractPortFromCommand("opencode --port 1024")).toBeUndefined();
    expect(harness.extractPortFromCommand("opencode without a port")).toBeUndefined();
  });

  it("filters workspace matches for missing workspace folders and missing instance paths", () => {
    const instances: OpenCodeInstance[] = [
      { pid: 1, port: 34001 },
      { pid: 2, port: 34002, workspacePath: "/workspace/current" },
    ];

    setWorkspaceFolders(undefined);
    expect(asHarness(service).filterByWorkspace(instances)).toEqual(instances);

    setWorkspaceFolders([{ uri: { fsPath: "/workspace/current" } }]);
    expect(asHarness(service).filterByWorkspace(instances)).toEqual([
      { pid: 2, port: 34002, workspacePath: "/workspace/current" },
    ]);
  });

  it("waits for spawn readiness across retries, sleep, errors, and disposal", async () => {
    vi.useFakeTimers();
    const harness = asHarness(service);
    const sleepSpy = vi.spyOn(harness, "sleep").mockResolvedValue(undefined);
    vi.spyOn(harness, "healthCheck")
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(harness.waitForSpawnReadiness(35001)).resolves.toBe(true);
    expect(sleepSpy).toHaveBeenCalledTimes(2);

    service.dispose();
    await expect(harness.waitForSpawnReadiness(35001)).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("returns false when spawned process never becomes healthy", async () => {
    const harness = asHarness(service);
    vi.spyOn(harness, "sleep").mockResolvedValue(undefined);
    vi.spyOn(harness, "healthCheck").mockResolvedValue(false);

    await expect(harness.waitForSpawnReadiness(35002)).resolves.toBe(false);
  });

  it("handles auto-spawn command resolution failures and child process failures", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "defaultAiTool") {
          return "custom";
        }

        if (key === "aiTools") {
          return [{ name: "", label: "Blank", path: "", args: [] }];
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);
    service = new InstanceDiscoveryService();
    await expect(asHarness(service).spawnOpenCode()).resolves.toBeUndefined();

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "defaultAiTool") {
          return "custom";
        }

        if (key === "aiTools") {
          return [
            { name: "custom", label: "Custom", path: '"unterminated', args: [] },
          ];
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);
    service = new InstanceDiscoveryService();
    await expect(asHarness(service).spawnOpenCode()).resolves.toBeUndefined();

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "defaultAiTool") {
          return "opencode";
        }

        if (key === "aiTools") {
          return [];
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);

    service = new InstanceDiscoveryService();
    vi.mocked(execFile).mockReturnValueOnce(createChildProcess(undefined));
    await expect(asHarness(service).spawnOpenCode()).resolves.toBeUndefined();

    vi.mocked(execFile).mockReturnValueOnce(createChildProcess(36001, "error"));
    await expect(asHarness(service).spawnOpenCode()).resolves.toBeUndefined();

    vi.mocked(execFile).mockReturnValueOnce(
      createChildProcess(36002, "exit-nonzero"),
    );
    await expect(asHarness(service).spawnOpenCode()).resolves.toBeUndefined();
  });

  it("covers process-start timeout and late child event handlers", async () => {
    vi.useFakeTimers();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "defaultAiTool") {
          return "opencode";
        }

        if (key === "aiTools") {
          return [];
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);
    service = new InstanceDiscoveryService();
    const child = {
      pid: 36003,
      on: vi.fn((event: string, handler: (code?: number) => void) => {
        if (event === "error") {
          setTimeout(() => handler(), 600);
        }

        if (event === "exit") {
          setTimeout(() => handler(1), 700);
        }

        return child;
      }),
    } as unknown as ChildProcess;
    vi.mocked(execFile).mockReturnValueOnce(child);
    vi.spyOn(asHarness(service), "waitForSpawnReadiness").mockResolvedValueOnce(
      false,
    );

    const spawned = asHarness(service).spawnOpenCode();
    await vi.advanceTimersByTimeAsync(500);
    await expect(spawned).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
  });

  it("resolves the real sleep timer", async () => {
    vi.useFakeTimers();
    const slept = asHarness(service).sleep(25);

    await vi.advanceTimersByTimeAsync(25);
    await expect(slept).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("handles auto-spawn readiness failure, exec throw, and workspace fallback", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "defaultAiTool") {
          return "opencode";
        }

        if (key === "aiTools") {
          return [];
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);
    setWorkspaceFolders([{ uri: { fsPath: "/workspace/fallback" } }]);
    service = new InstanceDiscoveryService();

    vi.mocked(execFile).mockReturnValueOnce(createChildProcess(37001, "exit-zero"));
    vi.spyOn(asHarness(service), "waitForSpawnReadiness").mockResolvedValueOnce(
      false,
    );
    await expect(asHarness(service).spawnOpenCode()).resolves.toBeUndefined();

    vi.mocked(execFile).mockImplementationOnce(() => {
      throw "exec failed";
    });
    await expect(asHarness(service).spawnOpenCode()).resolves.toBeUndefined();

    vi.mocked(execFile).mockReturnValueOnce(createChildProcess(37002, "exit-zero"));
    vi.spyOn(asHarness(service), "waitForSpawnReadiness").mockResolvedValueOnce(
      true,
    );
    vi.spyOn(asHarness(service), "getWorkspacePath").mockResolvedValueOnce(
      undefined,
    );

    await expect(asHarness(service).spawnOpenCode()).resolves.toMatchObject({
      pid: 37002,
      workspacePath: "/workspace/fallback",
    });
  });

  it("uses the built-in default command when auto-spawning", async () => {
    service = new InstanceDiscoveryService();
    vi.mocked(execFile).mockReturnValueOnce(createChildProcess(37003, "exit-zero"));
    vi.spyOn(asHarness(service), "waitForSpawnReadiness").mockResolvedValueOnce(
      false,
    );

    await expect(asHarness(service).spawnOpenCode()).resolves.toBeUndefined();

    expect(execFile).toHaveBeenCalledWith(
      "opencode",
      ["-c"],
      expect.objectContaining({
        env: expect.objectContaining({ OPENCODE_CALLER: "vscode" }),
      }),
    );
  });

  it("logs Error spawn failures", async () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "defaultAiTool") {
          return "opencode";
        }

        if (key === "aiTools") {
          return [];
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);
    service = new InstanceDiscoveryService();
    vi.mocked(execFile).mockImplementationOnce(() => {
      throw new Error("exec failed");
    });

    await expect(asHarness(service).spawnOpenCode()).resolves.toBeUndefined();
  });

  it("covers an already-resolved process-start timeout callback", async () => {
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation(
      (handler: (_: void) => void, timeout?: number) => {
        if (timeout === 500 && typeof handler === "function") {
          handler(undefined);
          handler(undefined);
          const handle = realSetTimeout(() => undefined, 0);
          clearTimeout(handle);
          return handle;
        }

        return realSetTimeout(handler, timeout);
      },
    );
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "defaultAiTool") {
          return "opencode";
        }

        if (key === "aiTools") {
          return [];
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);
    service = new InstanceDiscoveryService();
    vi.mocked(execFile).mockReturnValueOnce(createChildProcess(37004));
    vi.spyOn(asHarness(service), "waitForSpawnReadiness").mockResolvedValueOnce(
      false,
    );

    await expect(asHarness(service).spawnOpenCode()).resolves.toBeUndefined();
  });

  it("parses escaped whitespace, escaped quotes, empty command, and validates port bounds", () => {
    const harness = asHarness(service);

    expect(harness.parseCommand("opencode\\ cli --profile dev\\ mode")).toEqual({
      file: "opencode cli",
      args: ["--profile", "dev mode"],
    });
    expect(harness.parseCommand("'open\\'code' \"arg\\\"value\"")).toEqual({
      file: "open'code",
      args: ['arg"value'],
    });
    expect(harness.parseCommand("   ")).toBeUndefined();
    expect(harness.generateEphemeralPort()).toBeGreaterThanOrEqual(16384);
    expect(harness.generateEphemeralPort()).toBeLessThanOrEqual(65535);
    expect(harness.isEphemeralPort(16384)).toBe(true);
    expect(harness.isEphemeralPort(65535)).toBe(true);
    expect(harness.isEphemeralPort(16383)).toBe(false);
    expect(harness.isEphemeralPort(65536)).toBe(false);
    expect(harness.isEphemeralPort(12.5)).toBe(false);
    expect(harness.normalizePath("/workspace/../workspace/current")).toContain(
      "workspace/current",
    );
    expect(harness.normalizePath("   ")).toBe("");
  });
});
