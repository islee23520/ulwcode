import { vi } from "vitest";

export interface MockPtyProcess {
  readonly pid: number;
  readonly write: ReturnType<typeof vi.fn>;
  readonly resize: ReturnType<typeof vi.fn>;
  readonly kill: ReturnType<typeof vi.fn>;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void;
  };
  emitData(data: string): void;
  emitExit(exitCode: number, signal?: number): void;
}

export function createMockPtyProcess(): MockPtyProcess {
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();
  return {
    pid: 12345,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData(listener) {
      dataListeners.add(listener);
      return { dispose: () => dataListeners.delete(listener) };
    },
    onExit(listener) {
      exitListeners.add(listener);
      return { dispose: () => exitListeners.delete(listener) };
    },
    emitData(data) {
      for (const listener of dataListeners) {
        listener(data);
      }
    },
    emitExit(exitCode, signal) {
      for (const listener of exitListeners) {
        listener({ exitCode, signal });
      }
    },
  };
}

export const spawn = vi.fn(() => createMockPtyProcess());
