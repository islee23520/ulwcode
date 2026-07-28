import { vi } from "vitest";

export class Disposable {
  public constructor(private readonly callback: () => void = () => undefined) {}

  public dispose(): void {
    this.callback();
  }
}

export class EventEmitter<T> {
  private readonly listeners = new Set<(event: T) => unknown>();

  public readonly event = (listener: (event: T) => unknown): Disposable => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };

  public fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public dispose(): void {
    this.listeners.clear();
  }
}

export class Uri {
  public constructor(public readonly fsPath: string) {}

  public static file(path: string): Uri {
    return new Uri(path);
  }

  public static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri([base.fsPath, ...segments].join("/"));
  }

  public toString(): string {
    return `file://${this.fsPath}`;
  }
}

const configuration = new Map<string, unknown>();
const configurationEmitter = new EventEmitter<{
  affectsConfiguration(section: string): boolean;
}>();

export function setConfiguration(values: Readonly<Record<string, unknown>>): void {
  configuration.clear();
  for (const [key, value] of Object.entries(values)) {
    configuration.set(key, value);
  }
}

export const workspace = {
  workspaceFolders: [{ uri: Uri.file(process.cwd()) }],
  getConfiguration: vi.fn((section: string) => ({
    get<T>(key: string, fallback?: T): T {
      return (configuration.get(`${section}.${key}`) as T | undefined) ?? (fallback as T);
    },
  })),
  onDidChangeConfiguration: configurationEmitter.event,
};

export function fireConfigurationChange(section: string): void {
  configurationEmitter.fire({
    affectsConfiguration: (candidate) => candidate === section,
  });
}

export const env = {
  shell: "/bin/mock-shell",
  clipboard: {
    writeText: vi.fn(async (_text: string) => undefined),
    readText: vi.fn(async () => ""),
  },
};

export const window = {
  registerWebviewViewProvider: vi.fn(() => new Disposable()),
};

export function resetMocks(): void {
  setConfiguration({});
  window.registerWebviewViewProvider.mockClear();
  workspace.getConfiguration.mockClear();
  env.shell = "/bin/mock-shell";
  env.clipboard.writeText.mockClear();
  env.clipboard.readText.mockClear();
}

export default {
  Disposable,
  EventEmitter,
  Uri,
  workspace,
  env,
  window,
};
