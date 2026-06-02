import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceRegistry } from "./InstanceRegistry";
import { InstanceStore } from "./InstanceStore";
import type * as vscodeTypes from "../test/mocks/vscode";

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

const GLOBAL_INSTANCES_KEY = "ulw.instances.global";
const WORKSPACE_INSTANCES_KEY = "ulw.instances.workspace";
const LEGACY_INSTANCE_KEY = "ulw.instanceConfig";

function createContext(options?: {
  globalValues?: Record<string, unknown>;
  workspaceValues?: Record<string, unknown>;
}): {
  context: vscodeTypes.ExtensionContext;
  globalValues: Record<string, unknown>;
  workspaceValues: Record<string, unknown>;
} {
  const context = new vscode.ExtensionContext();
  const globalValues = { ...(options?.globalValues ?? {}) };
  const workspaceValues = { ...(options?.workspaceValues ?? {}) };

  vi.mocked(context.globalState.get).mockImplementation((key: string) => {
    return globalValues[key];
  });
  vi.mocked(context.workspaceState.get).mockImplementation((key: string) => {
    return workspaceValues[key];
  });

  vi.mocked(context.globalState.update).mockImplementation(
    async (key: string, value: unknown) => {
      globalValues[key] = value;
    },
  );
  vi.mocked(context.workspaceState.update).mockImplementation(
    async (key: string, value: unknown) => {
      workspaceValues[key] = value;
    },
  );

  return { context, globalValues, workspaceValues };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe("InstanceRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates valid persisted configs, filters invalid data, and restores the active instance", () => {
    const { context } = createContext({
      globalValues: {
        [GLOBAL_INSTANCES_KEY]: [
          { id: "global-only", label: "Global Only" },
          { id: "shared", label: "Global Shared" },
          null,
          { label: "missing-id" },
        ],
      },
      workspaceValues: {
        [WORKSPACE_INSTANCES_KEY]: {
          activeInstanceId: "workspace-only",
          instances: [
            {
              id: "workspace-only",
              workspaceUri: "file:///workspace",
              label: "Workspace Only",
              args: ["--workspace", 123],
            },
            {
              id: "shared",
              workspaceUri: "file:///workspace",
              label: "Workspace Shared",
              preferredPort: 4100,
              enableHttpApi: true,
            },
            "invalid-entry",
          ],
        },
      },
    });
    const registry = new InstanceRegistry(
      context as unknown as ConstructorParameters<typeof InstanceRegistry>[0],
    );
    const store = new InstanceStore();

    registry.hydrate(store);

    expect(store.getAll()).toHaveLength(3);
    expect(store.get("global-only")?.config).toMatchObject({
      id: "global-only",
      label: "Global Only",
    });
    expect(store.get("workspace-only")?.config).toMatchObject({
      id: "workspace-only",
      workspaceUri: "file:///workspace",
      label: "Workspace Only",
      args: ["--workspace"],
    });
    expect(store.get("shared")?.config).toMatchObject({
      id: "shared",
      workspaceUri: "file:///workspace",
      label: "Workspace Shared",
      preferredPort: 4100,
      enableHttpApi: true,
    });
    expect(store.getActive().config.id).toBe("workspace-only");
  });

  it("migrates legacy persisted config into the default instance when modern state is empty", () => {
    const { context } = createContext({
      globalValues: {
        [LEGACY_INSTANCE_KEY]: {
          workspaceUri: "file:///legacy",
          label: "Legacy Instance",
          args: ["--legacy", 99],
          selectedAiTool: "codex",
          preferredPort: 3200,
          enableHttpApi: true,
        },
      },
      workspaceValues: {
        [WORKSPACE_INSTANCES_KEY]: "not-an-object",
        ulw: {},
      },
    });
    const registry = new InstanceRegistry(
      context as unknown as ConstructorParameters<typeof InstanceRegistry>[0],
    );
    const store = new InstanceStore();

    registry.hydrate(store);

    expect(store.getAll()).toHaveLength(1);
    expect(store.get("default")?.config).toEqual({
      id: "default",
      workspaceUri: "file:///legacy",
      label: "Legacy Instance",
      args: ["--legacy"],
      selectedAiTool: "codex",
      preferredPort: 3200,
      enableHttpApi: true,
    });
    expect(store.getActive().config.id).toBe("default");
  });

  it("migrates the first workspace legacy config before global legacy fallback", () => {
    const { context } = createContext({
      globalValues: {
        "ulw.instance": {
          label: "Global Legacy",
          preferredPort: 4100,
        },
      },
      workspaceValues: {
        "ulw.instance": {
          workspaceUri: "file:///workspace-legacy",
          label: "Workspace Legacy",
          args: ["--ok", false, "--still-ok"],
          selectedAiTool: "opencode",
          enableHttpApi: false,
        },
      },
    });
    const registry = new InstanceRegistry(
      context as unknown as ConstructorParameters<typeof InstanceRegistry>[0],
    );
    const store = new InstanceStore();

    registry.hydrate(store);

    expect(store.get("default")?.config).toEqual({
      id: "default",
      workspaceUri: "file:///workspace-legacy",
      label: "Workspace Legacy",
      args: ["--ok", "--still-ok"],
      selectedAiTool: "opencode",
      preferredPort: undefined,
      enableHttpApi: false,
    });
  });

  it("ignores malformed workspace active ids and empty legacy configs", () => {
    const { context } = createContext({
      globalValues: {
        "ulw.instance": {
          workspaceUri: 123,
          label: null,
          args: "--bad",
          selectedAiTool: false,
          preferredPort: "4100",
          enableHttpApi: "yes",
        },
      },
      workspaceValues: {
        [WORKSPACE_INSTANCES_KEY]: {
          activeInstanceId: 42,
          instances: [{ id: "survivor", selectedAiTool: 7 }],
        },
      },
    });
    const registry = new InstanceRegistry(context as any);
    const store = new InstanceStore();

    registry.hydrate(store);

    expect(store.getAll()).toHaveLength(1);
    expect(store.getActive().config.id).toBe("survivor");
    expect(store.get("survivor")?.config.selectedAiTool).toBeUndefined();
  });

  it("does not migrate legacy configs when every legacy field is malformed", () => {
    const { context } = createContext({
      globalValues: {
        "ulw.instance": {
          workspaceUri: 123,
          label: null,
          args: "--bad",
          selectedAiTool: false,
          preferredPort: "4100",
          enableHttpApi: "yes",
        },
      },
    });
    const registry = new InstanceRegistry(
      context as unknown as ConstructorParameters<typeof InstanceRegistry>[0],
    );
    const store = new InstanceStore();

    registry.hydrate(store);

    expect(store.getAll()).toEqual([]);
  });

  it("migrates each standalone legacy field", () => {
    const legacyCases: Array<{
      legacy: Record<string, unknown>;
      expected: Record<string, unknown>;
    }> = [
      { legacy: { label: "Label Only" }, expected: { label: "Label Only" } },
      { legacy: { args: ["--arg"] }, expected: { args: ["--arg"] } },
      {
        legacy: { selectedAiTool: "codex" },
        expected: { selectedAiTool: "codex" },
      },
      { legacy: { preferredPort: 4300 }, expected: { preferredPort: 4300 } },
      { legacy: { enableHttpApi: true }, expected: { enableHttpApi: true } },
    ];

    for (const { legacy, expected } of legacyCases) {
      const { context } = createContext({
        globalValues: { "ulw.instance": legacy },
      });
      const registry = new InstanceRegistry(
        context as unknown as ConstructorParameters<typeof InstanceRegistry>[0],
      );
      const store = new InstanceStore();

      registry.hydrate(store);

      expect(store.get("default")?.config).toMatchObject({
        id: "default",
        ...expected,
      });
    }
  });

  it("persists global and workspace instances into separate state buckets", async () => {
    const { context, globalValues, workspaceValues } = createContext();
    const registry = new InstanceRegistry(context as any);
    const store = new InstanceStore();

    store.upsert({
      config: { id: "global-instance", label: "Global" },
      runtime: { port: 1111 },
      state: "connected",
    });
    store.upsert({
      config: {
        id: "workspace-instance",
        workspaceUri: "file:///workspace",
        label: "Workspace",
        args: ["--workspace"],
      },
      runtime: { port: 2222 },
      state: "connected",
    });
    store.setActive("workspace-instance");

    await registry.persist(store);

    expect(context.globalState.update).toHaveBeenCalledWith(
      GLOBAL_INSTANCES_KEY,
      [{ id: "global-instance", label: "Global" }],
    );
    expect(context.workspaceState.update).toHaveBeenCalledWith(
      WORKSPACE_INSTANCES_KEY,
      {
        activeInstanceId: "workspace-instance",
        instances: [
          {
            id: "workspace-instance",
            workspaceUri: "file:///workspace",
            label: "Workspace",
            args: ["--workspace"],
          },
        ],
      },
    );
    expect(globalValues[GLOBAL_INSTANCES_KEY]).toEqual([
      { id: "global-instance", label: "Global" },
    ]);
    expect(workspaceValues[WORKSPACE_INSTANCES_KEY]).toEqual({
      activeInstanceId: "workspace-instance",
      instances: [
        {
          id: "workspace-instance",
          workspaceUri: "file:///workspace",
          label: "Workspace",
          args: ["--workspace"],
        },
      ],
    });
  });

  it("hydrates selected AI tools from persisted configs", () => {
    const { context } = createContext({
      globalValues: {
        [GLOBAL_INSTANCES_KEY]: [
          { id: "with-tool", selectedAiTool: "opencode" },
        ],
      },
    });
    const registry = new InstanceRegistry(
      context as unknown as ConstructorParameters<typeof InstanceRegistry>[0],
    );
    const store = new InstanceStore();

    registry.hydrate(store);

    expect(store.get("with-tool")?.config.selectedAiTool).toBe("opencode");
  });

  it("filters records whose config cannot be serialized", async () => {
    const { context, globalValues } = createContext();
    const registry = new InstanceRegistry(context as any);
    const store = new InstanceStore();

    store.upsert({
      config: { id: "" },
      runtime: {},
      state: "disconnected",
    });

    await registry.persist(store);

    expect(globalValues[GLOBAL_INSTANCES_KEY]).toEqual([]);
    expect(context.workspaceState.update).toHaveBeenCalledWith(
      WORKSPACE_INSTANCES_KEY,
      { activeInstanceId: "", instances: [] },
    );
  });

  describe("terminalBackend persistence", () => {
    it("hydrates malformed terminalBackend values as undefined", () => {
      const { context } = createContext({
        globalValues: {
          [GLOBAL_INSTANCES_KEY]: [
            {
              id: "malformed-backend",
              label: "Malformed Backend",
              terminalBackend: 7,
            },
          ],
        },
      });
      const registry = new InstanceRegistry(
        context as unknown as ConstructorParameters<typeof InstanceRegistry>[0],
      );
      const store = new InstanceStore();

      registry.hydrate(store);

      expect(store.get("malformed-backend")?.config).toMatchObject({
        id: "malformed-backend",
        label: "Malformed Backend",
      });
      expect(
        store.get("malformed-backend")?.config.terminalBackend,
      ).toBeUndefined();
    });

    it("preserves terminalBackend through a persist and hydrate roundtrip", async () => {
      const { context, globalValues, workspaceValues } = createContext();
      const registry = new InstanceRegistry(context as any);
      const store = new InstanceStore();

      store.upsert({
        config: {
          id: "global-backend",
          label: "Global Backend",
          terminalBackend: "tmux",
        },
        runtime: { terminalBackend: "native" },
        state: "connected",
      });
      store.upsert({
        config: {
          id: "workspace-backend",
          workspaceUri: "file:///workspace",
          label: "Workspace Backend",
          terminalBackend: "zellij",
        },
        runtime: { terminalBackend: "tmux" },
        state: "connected",
      });
      store.setActive("workspace-backend");

      await registry.persist(store);

      const globalConfigs = globalValues[GLOBAL_INSTANCES_KEY] as Array<{
        terminalBackend?: string;
      }>;
      const workspaceState = workspaceValues[
        WORKSPACE_INSTANCES_KEY
      ] as { instances: Array<{ terminalBackend?: string }> };
      expect(globalConfigs[0]).toMatchObject({
        id: "global-backend",
        terminalBackend: "tmux",
      });
      expect(workspaceState.instances[0]).toMatchObject({
        id: "workspace-backend",
        terminalBackend: "zellij",
      });

      const hydratedStore = new InstanceStore();
      new InstanceRegistry(context as any).hydrate(hydratedStore);

      expect(hydratedStore.get("global-backend")?.config.terminalBackend).toBe(
        "tmux",
      );
      expect(hydratedStore.get("workspace-backend")?.config.terminalBackend).toBe(
        "zellij",
      );
      expect(hydratedStore.getActive().config.id).toBe("workspace-backend");
    });

    it("migrates runtime.terminalBackend to config during persist", async () => {
      const { context, globalValues } = createContext();
      const registry = new InstanceRegistry(context as any);
      const store = new InstanceStore();

      store.upsert({
        config: { id: "runtime-only", label: "Runtime Only" },
        runtime: { terminalBackend: "native" },
        state: "connected",
      });

      await registry.persist(store);

      const globalConfigs = globalValues[GLOBAL_INSTANCES_KEY] as Array<{
        terminalBackend?: string;
      }>;
      expect(globalConfigs[0]).toMatchObject({
        id: "runtime-only",
        terminalBackend: "native",
      });

      const hydratedStore = new InstanceStore();
      new InstanceRegistry(context as any).hydrate(hydratedStore);

      expect(hydratedStore.get("runtime-only")?.config.terminalBackend).toBe(
        "native",
      );
    });

    it("handles legacy instances without terminalBackend", async () => {
      const { context } = createContext({
        globalValues: {
          [GLOBAL_INSTANCES_KEY]: [{ id: "legacy", label: "Legacy" }],
        },
      });
      const registry = new InstanceRegistry(context as any);
      const store = new InstanceStore();

      registry.hydrate(store);

      expect(store.get("legacy")?.config).toMatchObject({
        id: "legacy",
        label: "Legacy",
      });
      expect(store.get("legacy")?.config.terminalBackend).toBeUndefined();

      await registry.persist(store);

      expect(context.globalState.update).toHaveBeenCalledWith(
        GLOBAL_INSTANCES_KEY,
        [expect.objectContaining({ id: "legacy", label: "Legacy" })],
      );
    });

    it("keeps config.terminalBackend when runtime has a different backend", async () => {
      const { context, globalValues } = createContext();
      const registry = new InstanceRegistry(context as any);
      const store = new InstanceStore();

      store.upsert({
        config: { id: "config-wins", terminalBackend: "tmux" },
        runtime: { terminalBackend: "native" },
        state: "connected",
      });

      await registry.persist(store);

      const globalConfigs = globalValues[GLOBAL_INSTANCES_KEY] as Array<{
        terminalBackend?: string;
      }>;
      expect(globalConfigs[0]).toMatchObject({
        id: "config-wins",
        terminalBackend: "tmux",
      });
    });

    it("persists multiple mixed backend types without cross-contaminating configs", async () => {
      const { context, globalValues, workspaceValues } = createContext();
      const registry = new InstanceRegistry(
        context as unknown as ConstructorParameters<typeof InstanceRegistry>[0],
      );
      const store = new InstanceStore();

      store.upsert({
        config: { id: "native-global", terminalBackend: "native" },
        runtime: { terminalBackend: "native" },
        state: "connected",
      });
      store.upsert({
        config: { id: "tmux-global", terminalBackend: "tmux" },
        runtime: { terminalBackend: "tmux" },
        state: "connected",
      });
      store.upsert({
        config: {
          id: "zellij-workspace",
          workspaceUri: "file:///workspace/zellij",
          terminalBackend: "zellij",
        },
        runtime: { terminalBackend: "zellij" },
        state: "connected",
      });

      await registry.persist(store);

      expect(globalValues[GLOBAL_INSTANCES_KEY]).toEqual([
        { id: "native-global", terminalBackend: "native" },
        { id: "tmux-global", terminalBackend: "tmux" },
      ]);
      expect(workspaceValues[WORKSPACE_INSTANCES_KEY]).toEqual({
        activeInstanceId: "native-global",
        instances: [
          {
            id: "zellij-workspace",
            workspaceUri: "file:///workspace/zellij",
            terminalBackend: "zellij",
          },
        ],
      });
    });
  });

  it("persists undefined active id when the store is empty", async () => {
    const { context } = createContext();
    const registry = new InstanceRegistry(context as any);

    await registry.persist(new InstanceStore());

    expect(context.globalState.update).toHaveBeenCalledWith(
      GLOBAL_INSTANCES_KEY,
      [],
    );
    expect(context.workspaceState.update).toHaveBeenCalledWith(
      WORKSPACE_INSTANCES_KEY,
      {
        activeInstanceId: undefined,
        instances: [],
      },
    );
  });

  it("coalesces rapid store changes into a single debounced persist", async () => {
    vi.useFakeTimers();

    const { context } = createContext();
    const registry = new InstanceRegistry(context as any, 25);
    const store = new InstanceStore();
    const persistSpy = vi
      .spyOn(registry, "persist")
      .mockResolvedValue(undefined);

    registry.hydrate(store);

    store.upsert({
      config: { id: "first" },
      runtime: {},
      state: "disconnected",
    });
    store.upsert({
      config: { id: "second" },
      runtime: {},
      state: "disconnected",
    });
    store.setActive("second");

    vi.advanceTimersByTime(24);
    expect(persistSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await flushMicrotasks();

    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledWith(store);
  });

  it("flushes a pending timer during dispose and unsubscribes from future store changes", async () => {
    vi.useFakeTimers();

    const { context } = createContext();
    const registry = new InstanceRegistry(context as any, 25);
    const store = new InstanceStore();
    const persistSpy = vi
      .spyOn(registry, "persist")
      .mockResolvedValue(undefined);

    registry.hydrate(store);

    store.upsert({
      config: { id: "first" },
      runtime: {},
      state: "disconnected",
    });

    registry.dispose();
    await flushMicrotasks();

    expect(persistSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(25);
    await flushMicrotasks();
    expect(persistSpy).toHaveBeenCalledTimes(1);

    store.upsert({
      config: { id: "second" },
      runtime: {},
      state: "disconnected",
    });
    vi.advanceTimersByTime(25);
    await flushMicrotasks();

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows persist errors from the debounced timer callback", async () => {
    vi.useFakeTimers();

    const { context } = createContext();
    const registry = new InstanceRegistry(context as any, 25);
    const store = new InstanceStore();
    const persistSpy = vi
      .spyOn(registry, "persist")
      .mockRejectedValue(new Error("timer persist failed"));

    registry.hydrate(store);
    store.upsert({
      config: { id: "first" },
      runtime: {},
      state: "disconnected",
    });

    expect(() => {
      vi.advanceTimersByTime(25);
    }).not.toThrow();
    await flushMicrotasks();

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows persist errors when dispose flushes a pending timer", async () => {
    vi.useFakeTimers();

    const { context } = createContext();
    const registry = new InstanceRegistry(context as any, 25);
    const store = new InstanceStore();
    const persistSpy = vi
      .spyOn(registry, "persist")
      .mockRejectedValue(new Error("dispose persist failed"));

    registry.hydrate(store);
    store.upsert({
      config: { id: "first" },
      runtime: {},
      state: "disconnected",
    });

    expect(() => registry.dispose()).not.toThrow();
    await flushMicrotasks();

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it("disposes without persisting when no debounce timer is pending", () => {
    const { context } = createContext();
    const registry = new InstanceRegistry(
      context as unknown as ConstructorParameters<typeof InstanceRegistry>[0],
      25,
    );
    const store = new InstanceStore();
    const persistSpy = vi.spyOn(registry, "persist");

    registry.hydrate(store);
    registry.dispose();

    expect(persistSpy).not.toHaveBeenCalled();
  });

  it("clears a pending timer without persisting when no hydrated store remains", () => {
    vi.useFakeTimers();
    const { context } = createContext();
    const registry = new InstanceRegistry(
      context as unknown as ConstructorParameters<typeof InstanceRegistry>[0],
      25,
    );
    const persistSpy = vi.spyOn(registry, "persist");

    Object.defineProperty(registry, "persistTimer", {
      value: setTimeout(() => undefined, 25),
      writable: true,
    });
    Object.defineProperty(registry, "hydratedStore", {
      value: undefined,
      writable: true,
    });

    registry.dispose();

    expect(persistSpy).not.toHaveBeenCalled();
  });
});
