import * as os from "os";
import * as pty from "node-pty";
import * as vscode from "vscode";

export interface TerminalDataEvent {
  readonly id: string;
  readonly data: string;
}

export interface TerminalExitEvent {
  readonly id: string;
  readonly code: number;
  readonly signal?: number;
}

export interface TerminalStartEvent {
  readonly id: string;
  readonly pid: number;
}

export class TerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<string, pty.IPty>();
  private readonly generations = new Map<string, number>();
  private readonly dataEmitter = new vscode.EventEmitter<TerminalDataEvent>();
  private readonly exitEmitter = new vscode.EventEmitter<TerminalExitEvent>();
  private readonly startEmitter = new vscode.EventEmitter<TerminalStartEvent>();

  public readonly onData = this.dataEmitter.event;
  public readonly onExit = this.exitEmitter.event;
  public readonly onStart = this.startEmitter.event;

  public createTerminal(
    id: string,
    cols: number,
    rows: number,
    cwd = this.resolveWorkingDirectory(),
  ): pty.IPty {
    const existing = this.terminals.get(id);
    if (existing) {
      return existing;
    }

    const configuration = vscode.workspace.getConfiguration("ulw");
    const configuredShell = configuration.get<string>("shellPath", "").trim();
    const shell = configuredShell || vscode.env.shell || this.defaultShell();
    const args = configuration.get<readonly string[]>("shellArgs", []);
    const generation = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, generation);

    const process = pty.spawn(shell, [...args], {
      name: "xterm-256color",
      cols: this.normalizeDimension(cols, 80),
      rows: this.normalizeDimension(rows, 24),
      cwd,
      env: this.buildEnvironment(),
    });

    this.terminals.set(id, process);
    this.startEmitter.fire({ id, pid: process.pid });
    process.onData((data) => {
      if (this.generations.get(id) === generation) {
        this.dataEmitter.fire({ id, data });
      }
    });
    process.onExit(({ exitCode, signal }) => {
      if (this.generations.get(id) !== generation) {
        return;
      }
      this.terminals.delete(id);
      this.exitEmitter.fire({ id, code: exitCode, signal });
    });

    return process;
  }

  public hasTerminal(id: string): boolean {
    return this.terminals.has(id);
  }

  public terminalCount(): number {
    return this.terminals.size;
  }

  public write(id: string, data: string): void {
    this.terminals.get(id)?.write(data);
  }

  public resize(id: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(id);
    if (!terminal || cols < 1 || rows < 1) {
      return;
    }
    terminal.resize(cols, rows);
  }

  public kill(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      return;
    }
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.terminals.delete(id);
    terminal.kill();
  }

  public dispose(): void {
    for (const id of [...this.terminals.keys()]) {
      this.kill(id);
    }
    this.dataEmitter.dispose();
    this.exitEmitter.dispose();
    this.startEmitter.dispose();
  }

  private resolveWorkingDirectory(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
  }

  private defaultShell(): string {
    if (process.platform === "win32") {
      return process.env.COMSPEC ?? "cmd.exe";
    }
    return process.env.SHELL ?? "/bin/sh";
  }

  private buildEnvironment(): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        environment[key] = value;
      }
    }
    environment.TERM = "xterm-256color";
    environment.COLORTERM = "truecolor";
    const utf8Locale =
      environment.LANG && environment.LANG.includes("UTF-8")
        ? environment.LANG
        : "en_US.UTF-8";
    if (!environment.LANG || !environment.LANG.includes("UTF-8")) {
      environment.LANG = utf8Locale;
    }
    if (!environment.LC_CTYPE) {
      environment.LC_CTYPE = environment.LANG;
    }
    return environment;
  }

  private normalizeDimension(value: number, fallback: number): number {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
