import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ThreadHistoryStore,
  type ThreadHistoryEntry,
} from "./ThreadHistoryStore";

interface TestMemento {
  readonly get: (
    key: string,
    defaultValue: readonly ThreadHistoryEntry[],
  ) => readonly ThreadHistoryEntry[] | undefined;
  readonly update: (
    key: string,
    next: readonly ThreadHistoryEntry[],
  ) => Promise<void>;
}

function createMemento(initial?: readonly ThreadHistoryEntry[]): TestMemento {
  let value = initial ? [...initial] : undefined;
  return {
    get: (_key, defaultValue) => value ?? defaultValue,
    update: async (_key, next) => {
      value = [...next];
    },
  };
}

describe("ThreadHistoryStore", () => {
  let now: Date;

  beforeEach(() => {
    now = new Date("2026-06-02T10:00:00.000Z");
  });

  it("sorts active thread metadata by updated time when entries are recorded", async () => {
    const store = new ThreadHistoryStore(createMemento(), () => now);

    // Given: three Zed-style thread metadata rows for one project.
    await store.record({
      id: "thread-old",
      kind: "agent",
      title: "Old planning",
      workspaceUri: "file:///work/repo",
      workspaceName: "repo",
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T08:00:00.000Z",
      status: "completed",
    });
    await store.record({
      id: "thread-new",
      kind: "agent",
      title: "Current ULW",
      workspaceUri: "file:///work/repo",
      workspaceName: "repo",
      createdAt: "2026-06-02T08:00:00.000Z",
      updatedAt: "2026-06-02T09:00:00.000Z",
      status: "running",
    });
    await store.record({
      id: "thread-tie",
      kind: "agent",
      title: "Tie breaker",
      workspaceUri: "file:///work/repo",
      workspaceName: "repo",
      createdAt: "2026-06-02T09:30:00.000Z",
      updatedAt: "2026-06-02T09:00:00.000Z",
      status: "completed",
    });

    // When: active threads are listed.
    const active = store.listActive();

    // Then: updatedAt desc and createdAt desc are preserved.
    expect(active.map((entry) => entry.id)).toEqual([
      "thread-tie",
      "thread-new",
      "thread-old",
    ]);
  });

  it("archives restores and permanently deletes agent threads", async () => {
    const store = new ThreadHistoryStore(createMemento(), () => now);
    await store.record({
      id: "thread-1",
      kind: "agent",
      title: "Implement project manager",
      workspaceUri: "file:///work/repo",
      workspaceName: "repo",
      createdAt: "2026-06-02T08:00:00.000Z",
      updatedAt: "2026-06-02T09:00:00.000Z",
      status: "completed",
    });

    // Given: an active agent thread.
    expect(store.listActive()).toHaveLength(1);

    // When: it is archived.
    await store.archive("thread-1");

    // Then: it leaves active rows but remains in history.
    expect(store.listActive()).toEqual([]);
    expect(store.listHistory({ archivedOnly: true }).map((entry) => entry.id)).toEqual([
      "thread-1",
    ]);

    // When: it is restored and then deleted.
    await store.restore("thread-1");
    await store.delete("thread-1");

    // Then: delete is permanent.
    expect(store.listHistory().map((entry) => entry.id)).toEqual([]);
  });

  it("preserves created time title override and archive state when observed again", async () => {
    const store = new ThreadHistoryStore(createMemento(), () => now);
    await store.record({
      id: "thread-1",
      kind: "agent",
      title: "Initial",
      titleOverride: "Pinned title",
      workspaceUri: "file:///work/repo",
      workspaceName: "repo",
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
      status: "completed",
    });
    await store.archive("thread-1");

    // Given: archived metadata with a user title override.
    // When: the same live thread is observed again by dashboard polling.
    await store.record({
      id: "thread-1",
      kind: "agent",
      title: "Observed title",
      workspaceUri: "file:///work/repo",
      workspaceName: "repo",
      createdAt: "2026-06-02T08:00:00.000Z",
      updatedAt: "2026-06-02T09:00:00.000Z",
      status: "running",
    });

    // Then: stable metadata is preserved while live fields update.
    expect(store.listHistory()[0]).toEqual(
      expect.objectContaining({
        id: "thread-1",
        title: "Observed title",
        titleOverride: "Pinned title",
        createdAt: "2026-06-01T08:00:00.000Z",
        updatedAt: "2026-06-02T09:00:00.000Z",
        archived: true,
      }),
    );
  });

  it("removes terminal threads instead of archiving them when terminal is closed", async () => {
    const store = new ThreadHistoryStore(createMemento(), () => now);
    await store.record({
      id: "terminal-1",
      kind: "terminal",
      terminalId: "terminal-1",
      title: "Shell 1",
      workspaceUri: "file:///work/repo",
      workspaceName: "repo",
      createdAt: "2026-06-02T08:00:00.000Z",
      updatedAt: "2026-06-02T08:00:00.000Z",
      status: "running",
    });

    // Given: a terminal thread row.
    expect(store.listHistory()).toHaveLength(1);

    // When: the terminal closes.
    await store.removeTerminal("terminal-1");

    // Then: it is gone, not archived.
    expect(store.listHistory()).toEqual([]);
  });

  it("marks unobserved running entries completed within the current workspace", async () => {
    const store = new ThreadHistoryStore(createMemento(), () => now);
    await store.record({
      id: "gone",
      kind: "agent",
      title: "Gone",
      workspaceUri: "file:///work/repo",
      workspaceName: "repo",
      createdAt: "2026-06-02T08:00:00.000Z",
      updatedAt: "2026-06-02T09:00:00.000Z",
      status: "running",
    });
    await store.record({
      id: "other",
      kind: "agent",
      title: "Other",
      workspaceUri: "file:///other/repo",
      workspaceName: "repo",
      createdAt: "2026-06-02T08:00:00.000Z",
      updatedAt: "2026-06-02T09:00:00.000Z",
      status: "running",
    });

    // Given: one running entry in the current workspace is no longer observed.
    // When: the dashboard reconciles observed entries for that workspace.
    await store.completeUnobserved(new Set(["still-running"]), "file:///work/repo");

    // Then: only the missing current-workspace row is completed.
    expect(store.listHistory().find((entry) => entry.id === "gone")?.status).toBe(
      "completed",
    );
    expect(store.listHistory().find((entry) => entry.id === "other")?.status).toBe(
      "running",
    );
  });

  it("marks an explicitly completed thread without deleting history", async () => {
    const store = new ThreadHistoryStore(createMemento(), () => now);
    await store.record({
      id: "thread-1",
      kind: "agent",
      title: "Killed session",
      workspaceUri: "file:///work/repo",
      workspaceName: "repo",
      createdAt: "2026-06-02T08:00:00.000Z",
      updatedAt: "2026-06-02T09:00:00.000Z",
      status: "running",
    });

    // Given: a running session history row.
    // When: the session is killed through the dashboard.
    await store.complete("thread-1");

    // Then: it remains in history as completed.
    expect(store.listHistory()[0]).toEqual(
      expect.objectContaining({ id: "thread-1", status: "completed" }),
    );
  });

  it("groups history by project URI and Zed archive time buckets", async () => {
    const store = new ThreadHistoryStore(createMemento(), () => now);

    // Given: history across same-named worktree paths.
    for (const entry of [
      {
        id: "today",
        workspaceUri: "file:///work/repo-a",
        workspaceName: "repo-a",
        updatedAt: "2026-06-02T09:00:00.000Z",
      },
      {
        id: "yesterday",
        workspaceUri: "file:///old/repo-a",
        workspaceName: "repo-a",
        updatedAt: "2026-06-01T09:00:00.000Z",
      },
      {
        id: "older",
        workspaceUri: "file:///work/repo-b",
        workspaceName: "repo-b",
        updatedAt: "2026-05-01T09:00:00.000Z",
      },
    ] as const) {
      await store.record({
        ...entry,
        kind: "agent",
        title: entry.id,
        createdAt: entry.updatedAt,
        status: "completed",
      });
    }

    // When: project groups and buckets are requested.
    const projectGroups = store.groupByProject();
    const buckets = store.groupByTimeBucket(now);

    // Then: same-named projects remain separated by URI.
    expect(projectGroups.map((group) => group.workspaceName)).toEqual([
      "repo-a",
      "repo-a",
      "repo-b",
    ]);
    expect(projectGroups[0]?.entries.map((entry) => entry.id)).toEqual([
      "today",
    ]);
    expect(projectGroups[1]?.entries.map((entry) => entry.id)).toEqual([
      "yesterday",
    ]);
    expect(buckets.map((bucket) => [bucket.bucket, bucket.entries.map((entry) => entry.id)])).toEqual([
      ["today", ["today"]],
      ["yesterday", ["yesterday"]],
      ["older", ["older"]],
    ]);
  });

  it("treats unknown archive restore delete ids as no-op boundaries", async () => {
    const store = new ThreadHistoryStore(createMemento(), () => now);

    // Given: an empty store.
    // When: unknown ids are changed.
    await store.archive("missing");
    await store.restore("missing");
    await store.delete("missing");

    // Then: the boundary remains stable.
    expect(store.listHistory()).toEqual([]);
  });
});
