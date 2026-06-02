export const THREAD_HISTORY_STORAGE_KEY = "ulw.threadHistory.entries";

export type ThreadHistoryKind = "agent" | "terminal";
export type ThreadHistoryStatus =
  | "running"
  | "completed"
  | "waiting"
  | "error";
export type ThreadHistoryBucket =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "pastWeek"
  | "older";

export interface ThreadHistoryEntry {
  readonly id: string;
  readonly kind: ThreadHistoryKind;
  readonly title: string;
  readonly titleOverride?: string;
  readonly sessionId?: string;
  readonly terminalId?: string;
  readonly agentId?: string;
  readonly workspaceUri?: string;
  readonly workspaceName?: string;
  readonly workingDirectory?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly interactedAt?: string;
  readonly status: ThreadHistoryStatus;
  readonly archived?: boolean;
}

export interface ThreadHistoryProjectGroup {
  readonly workspaceUri?: string;
  readonly workspaceName: string;
  readonly entries: readonly ThreadHistoryEntry[];
}

export interface ThreadHistoryTimeBucketGroup {
  readonly bucket: ThreadHistoryBucket;
  readonly entries: readonly ThreadHistoryEntry[];
}

interface ThreadHistoryMemento {
  get(
    key: string,
    defaultValue: readonly ThreadHistoryEntry[],
  ): readonly ThreadHistoryEntry[] | undefined;
  update(key: string, value: readonly ThreadHistoryEntry[]): Thenable<void>;
}

export class ThreadHistoryStore {
  private entries: readonly ThreadHistoryEntry[];

  constructor(
    private readonly memento: ThreadHistoryMemento,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.entries = this.readEntries();
  }

  public listActive(): readonly ThreadHistoryEntry[] {
    return this.sortEntries(this.entries.filter((entry) => !entry.archived));
  }

  public listHistory(options?: {
    readonly archivedOnly?: boolean;
  }): readonly ThreadHistoryEntry[] {
    const entries = options?.archivedOnly
      ? this.entries.filter((entry) => entry.archived)
      : this.entries;
    return this.sortEntries(entries);
  }

  public async record(entry: ThreadHistoryEntry): Promise<void> {
    const existing = this.entries.find((current) => current.id === entry.id);
    const nextEntry = this.normalizeEntry({
      ...entry,
      titleOverride: entry.titleOverride ?? existing?.titleOverride,
      createdAt: existing?.createdAt ?? entry.createdAt,
      archived: existing?.archived ?? entry.archived,
    });
    const nextEntries = [
      nextEntry,
      ...this.entries.filter((current) => current.id !== entry.id),
    ];
    await this.replaceEntries(nextEntries);
  }

  public async archive(id: string): Promise<void> {
    await this.updateEntry(id, (entry) => ({ ...entry, archived: true }));
  }

  public async restore(id: string): Promise<void> {
    await this.updateEntry(id, (entry) => ({ ...entry, archived: false }));
  }

  public async delete(id: string): Promise<void> {
    await this.replaceEntries(this.entries.filter((entry) => entry.id !== id));
  }

  public async complete(id: string): Promise<void> {
    await this.updateEntry(id, (entry) => ({
      ...entry,
      status: "completed",
      updatedAt: this.now().toISOString(),
    }));
  }

  public async completeUnobserved(
    observedIds: ReadonlySet<string>,
    workspaceUri?: string,
  ): Promise<void> {
    const timestamp = this.now().toISOString();
    await this.replaceEntries(
      this.entries.map((entry) => {
        const matchesWorkspace =
          !workspaceUri || entry.workspaceUri === workspaceUri;
        if (
          entry.status === "running" &&
          matchesWorkspace &&
          !observedIds.has(entry.id)
        ) {
          return { ...entry, status: "completed", updatedAt: timestamp };
        }
        return entry;
      }),
    );
  }

  public async removeTerminal(terminalId: string): Promise<void> {
    await this.replaceEntries(
      this.entries.filter(
        (entry) =>
          entry.kind !== "terminal" ||
          (entry.terminalId ?? entry.id) !== terminalId,
      ),
    );
  }

  public groupByProject(): readonly ThreadHistoryProjectGroup[] {
    const groups = new Map<string, ThreadHistoryEntry[]>();
    const labels = new Map<
      string,
      Pick<ThreadHistoryProjectGroup, "workspaceName" | "workspaceUri">
    >();

    for (const entry of this.listHistory()) {
      const workspaceName =
        entry.workspaceName ?? this.workspaceNameFromUri(entry.workspaceUri);
      const key = entry.workspaceUri ?? workspaceName;
      const current = groups.get(key) ?? [];
      groups.set(key, [...current, entry]);
      if (!labels.has(key)) {
        labels.set(key, { workspaceName, workspaceUri: entry.workspaceUri });
      }
    }

    return Array.from(groups.entries(), ([key, entries]) => {
      const label = labels.get(key);
      return {
        workspaceName: label?.workspaceName ?? key,
        workspaceUri: label?.workspaceUri,
        entries,
      };
    }).sort((left, right) =>
      left.workspaceName.localeCompare(right.workspaceName),
    );
  }

  public groupByTimeBucket(
    referenceDate: Date = this.now(),
  ): readonly ThreadHistoryTimeBucketGroup[] {
    const groups = new Map<ThreadHistoryBucket, ThreadHistoryEntry[]>();

    for (const entry of this.listHistory()) {
      const bucket = this.resolveBucket(new Date(entry.updatedAt), referenceDate);
      const current = groups.get(bucket) ?? [];
      groups.set(bucket, [...current, entry]);
    }

    const order: readonly ThreadHistoryBucket[] = [
      "today",
      "yesterday",
      "thisWeek",
      "pastWeek",
      "older",
    ];
    return order.flatMap((bucket) => {
      const entries = groups.get(bucket);
      return entries ? [{ bucket, entries }] : [];
    });
  }

  private async updateEntry(
    id: string,
    update: (entry: ThreadHistoryEntry) => ThreadHistoryEntry,
  ): Promise<void> {
    if (!this.entries.some((entry) => entry.id === id)) {
      return;
    }

    await this.replaceEntries(
      this.entries.map((entry) => (entry.id === id ? update(entry) : entry)),
    );
  }

  private async replaceEntries(
    entries: readonly ThreadHistoryEntry[],
  ): Promise<void> {
    this.entries = this.sortEntries(entries);
    await this.memento.update(THREAD_HISTORY_STORAGE_KEY, this.entries);
  }

  private readEntries(): readonly ThreadHistoryEntry[] {
    const raw = this.memento.get(THREAD_HISTORY_STORAGE_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return this.sortEntries(raw.map((entry) => this.normalizeEntry(entry)));
  }

  private normalizeEntry(entry: ThreadHistoryEntry): ThreadHistoryEntry {
    const timestamp = this.now().toISOString();
    return {
      ...entry,
      createdAt: entry.createdAt || timestamp,
      updatedAt: entry.updatedAt || entry.interactedAt || timestamp,
      archived: entry.archived ?? false,
    };
  }

  private sortEntries(
    entries: readonly ThreadHistoryEntry[],
  ): readonly ThreadHistoryEntry[] {
    return [...entries].sort((left, right) => {
      const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (updated !== 0) {
        return updated;
      }
      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    });
  }

  private resolveBucket(
    updatedAt: Date,
    referenceDate: Date,
  ): ThreadHistoryBucket {
    const updatedStart = this.startOfDay(updatedAt);
    const referenceStart = this.startOfDay(referenceDate);
    const days = Math.floor(
      (referenceStart.getTime() - updatedStart.getTime()) / 86_400_000,
    );

    if (days <= 0) {
      return "today";
    }
    if (days === 1) {
      return "yesterday";
    }
    if (days < 7) {
      return "thisWeek";
    }
    if (days < 14) {
      return "pastWeek";
    }
    return "older";
  }

  private startOfDay(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private workspaceNameFromUri(workspaceUri: string | undefined): string {
    if (!workspaceUri) {
      return "No workspace";
    }
    const parts = workspaceUri.split("/").filter((part) => part.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : workspaceUri;
  }
}
