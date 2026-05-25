export type DataThrottleBatchItem = {
  paneId: string;
  data: string;
};

export class DataThrottleService {
  private buffers = new Map<string, string[]>();

  private focusedPaneId: string | null = null;

  private timerId: ReturnType<typeof setTimeout> | null = null;

  private disposed = false;

  constructor(
    private readonly onBatch: (batch: Array<DataThrottleBatchItem>) => void,
  ) {}

  push(paneId: string, data: string): void {
    if (this.disposed) {
      return;
    }

    if (this.focusedPaneId === paneId) {
      this.deliver([{ paneId, data }]);
      return;
    }

    const existing = this.buffers.get(paneId);
    if (existing) {
      existing.push(data);
    } else {
      this.buffers.set(paneId, [data]);
    }

    this.scheduleFlush();
  }

  setFocusedPane(paneId: string): void {
    if (this.disposed) {
      return;
    }

    this.focusedPaneId = paneId;
  }

  flush(): void {
    if (this.disposed) {
      return;
    }

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    const batch = this.takeBufferedBatch();
    if (batch.length === 0) {
      return;
    }

    this.deliver(batch);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.focusedPaneId = null;
    this.buffers.clear();

    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private scheduleFlush(): void {
    if (this.timerId !== null) {
      return;
    }

    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.flush();
    }, 16);
  }

  private takeBufferedBatch(): DataThrottleBatchItem[] {
    const batch: DataThrottleBatchItem[] = [];

    for (const [paneId, chunks] of this.buffers.entries()) {
      if (chunks.length === 0) {
        continue;
      }

      batch.push({ paneId, data: chunks.join("") });
    }

    this.buffers.clear();
    return batch;
  }

  private deliver(batch: DataThrottleBatchItem[]): void {
    if (this.disposed || batch.length === 0) {
      return;
    }

    this.onBatch(batch);
  }
}
