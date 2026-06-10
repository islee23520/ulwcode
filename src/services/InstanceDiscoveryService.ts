import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { OpenCodeApiClient } from "./OpenCodeApiClient";
import { InstanceConfig, InstanceRecord, InstanceStore } from "./InstanceStore";
import { OutputChannelService } from "./OutputChannelService";
import { getToolLaunchCommand, resolveAiToolConfigs } from "../types";
import { normalizeComparablePath } from "../utils/pathUtils";

const MIN_PORT = 16384;
const MAX_PORT = 65535;
const DEFAULT_COMMAND = "opencode";
const SPAWN_HEALTH_RETRIES = 10;
const SPAWN_HEALTH_DELAY_MS = 200;

export interface OpenCodeInstance {
  port: number;
  pid: number;
  workspacePath?: string;
}

interface ProcessCandidate {
  pid: number;
  commandLine: string;
}

export class InstanceDiscoveryService {
  private instances: OpenCodeInstance[] = [];
  private autoSpawn: boolean;
  private enableProcessScan: boolean;
  private disposed = false;
  private readonly instanceStore?: InstanceStore;
  private readonly inflightControllers = new Set<AbortController>();
  private readonly logger = OutputChannelService.getInstance();

  constructor(instanceStore?: InstanceStore) {
    const config = vscode.workspace.getConfiguration("ulw");
    this.autoSpawn = config.get<boolean>("enableAutoSpawn", true);
    this.enableProcessScan = config.get<boolean>("enableProcessScan", true);
    this.instanceStore = instanceStore;
  }

  /**
   * Discovers healthy OpenCode instances for the current workspace and mirrors
   * discovered runtime metadata into the optional InstanceStore.
   */
  public async discoverInstances(): Promise<OpenCodeInstance[]> {
    if (this.disposed) {
      return [];
    }

    if (!this.enableProcessScan) {
      this.logger.debug("Process scanning disabled by configuration");
      return [];
    }

    const scanned = await this.scanProcesses();
    const healthyInstances: OpenCodeInstance[] = [];

    for (const candidate of scanned) {
      if (this.disposed) {
        return [];
      }

      try {
        const isHealthy = await this.healthCheck(candidate.port);
        if (!isHealthy) {
          continue;
        }

        const workspacePath = await this.getWorkspacePath(candidate.port);
        healthyInstances.push({
          pid: candidate.pid,
          port: candidate.port,
          workspacePath,
        });
      } catch (error) {
        this.logger.debug(
          `Health check failed for port ${candidate.port}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    }

    const matchedInstances = this.filterByWorkspace(healthyInstances);
    if (matchedInstances.length > 0) {
      this.instances = matchedInstances;
      this.syncToInstanceStore(this.instances);
      return [...this.instances];
    }

    if (this.autoSpawn) {
      const spawned = await this.spawnOpenCode();
      if (spawned) {
        this.instances = [spawned];
        this.syncToInstanceStore(this.instances);
        return [...this.instances];
      }
    }

    this.instances = [];
    this.syncToInstanceStore(this.instances);
    return [];
  }

  private syncToInstanceStore(instances: OpenCodeInstance[]): void {
    if (!this.instanceStore) {
      return;
    }

    // Build set of currently discovered IDs
    const currentDiscoveredIds = new Set<string>(
      instances.map((instance) => `discovered-${instance.port}`),
    );

    // Remove stale discovered-* entries that no longer exist
    for (const existing of this.instanceStore.getAll()) {
      if (
        existing.config.id.startsWith("discovered-") &&
        !currentDiscoveredIds.has(existing.config.id)
      ) {
        this.instanceStore.remove(existing.config.id);
      }
    }

    // Upsert currently discovered instances
    for (const instance of instances) {
      const instanceId = `discovered-${instance.port}`;
      const config: InstanceConfig = {
        id: instanceId,
        workspaceUri: instance.workspacePath,
        label: `Port ${instance.port}`,
        preferredPort: instance.port,
      };

      const record: InstanceRecord = {
        config,
        runtime: {
          port: instance.port,
          pid: instance.pid,
          lastSeenAt: Date.now(),
        },
        state: "disconnected",
      };

      this.instanceStore.upsert(record);
    }
  }

  private async scanProcesses(): Promise<OpenCodeInstance[]> {
    const platform = this.getPlatform();
    const candidates =
      platform === "win32"
        ? await this.scanWindowsProcesses()
        : await this.scanUnixProcesses();

    const instances: OpenCodeInstance[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const port = this.extractPortFromCommand(candidate.commandLine);
      if (port === undefined) {
        continue;
      }

      const key = `${candidate.pid}:${port}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      instances.push({
        pid: candidate.pid,
        port,
      });
    }

    return instances;
  }

  private async healthCheck(port: number): Promise<boolean> {
    const client = new OpenCodeApiClient(port, 1, 100, 1500);
    return client.healthCheck();
  }

  private async getWorkspacePath(port: number): Promise<string | undefined> {
    const controller = new AbortController();
    this.inflightControllers.add(controller);

    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return undefined;
      }

      const payload = (await response.json()) as {
        workspacePath?: string;
        cwd?: string;
        workspace?: string;
      };

      return payload.workspacePath ?? payload.cwd ?? payload.workspace;
    } catch (error) {
      this.logger.warn(
        `Failed to read workspace path from OpenCode health endpoint: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    } finally {
      this.inflightControllers.delete(controller);
      controller.abort();
    }
  }

  private async spawnOpenCode(): Promise<OpenCodeInstance | undefined> {
    const toolConfigs = resolveAiToolConfigs([]);
    const tool = toolConfigs[0];
    const command = (
      tool ? getToolLaunchCommand(tool) : DEFAULT_COMMAND
    ).trim();

    if (!command) {
      return undefined;
    }

    const parsed = this.parseCommand(command);
    if (!parsed) {
      this.logger.error(
        "Failed to parse AI tool launch command for auto-spawn. Check tool path/args quoting.",
      );
      return undefined;
    }

    const { file, args } = parsed;
    const port = this.generateEphemeralPort();
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    try {
      const child = execFile(file, args, {
        env: {
          ...process.env,
          _EXTENSION_OPENCODE_PORT: String(port),
          OPENCODE_CALLER: "vscode",
        },
      });

      if (!child.pid) {
        return undefined;
      }

      const processStarted = await new Promise<boolean>((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(true);
          }
        }, 500);

        child.on("error", () => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve(false);
          }
        });

        child.on("exit", (code) => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve(code === 0);
          }
        });
      });

      if (!processStarted) {
        return undefined;
      }

      const ready = await this.waitForSpawnReadiness(port);
      if (!ready) {
        this.logger.warn(
          `Spawned OpenCode process ${child.pid} did not become healthy on port ${port}`,
        );
        return undefined;
      }

      const detectedWorkspacePath = await this.getWorkspacePath(port);

      return {
        pid: child.pid,
        port,
        workspacePath: detectedWorkspacePath ?? workspacePath,
      };
    } catch (error) {
      this.logger.error(
        `Failed to spawn OpenCode instance: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.instances = [];

    for (const controller of this.inflightControllers) {
      controller.abort();
    }

    this.inflightControllers.clear();
  }

  private getPlatform(): NodeJS.Platform {
    return process.platform;
  }

  private async scanWindowsProcesses(): Promise<ProcessCandidate[]> {
    const stdout = await this.runCommand("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
    ]);

    if (!stdout.trim()) {
      return [];
    }

    try {
      const parsed = JSON.parse(stdout) as
        | {
            ProcessId?: number;
            Name?: string;
            CommandLine?: string;
          }
        | Array<{
            ProcessId?: number;
            Name?: string;
            CommandLine?: string;
          }>;

      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items
        .map((item) => ({
          pid: item.ProcessId ?? 0,
          commandLine: `${item.Name ?? ""} ${item.CommandLine ?? ""}`.trim(),
        }))
        .filter((item) => item.pid > 0 && /opencode/i.test(item.commandLine));
    } catch (error) {
      this.logger.warn(
        `Failed to parse Windows process list for OpenCode discovery: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async scanUnixProcesses(): Promise<ProcessCandidate[]> {
    const stdout = await this.runCommand("ps", ["-ax", "-o", "pid=,command="]);

    if (!stdout.trim()) {
      return [];
    }

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.+)$/);
        if (!match) {
          return undefined;
        }

        return {
          pid: Number(match[1]),
          commandLine: match[2],
        };
      })
      .filter((item): item is ProcessCandidate => Boolean(item))
      .filter((item) => /opencode/i.test(item.commandLine));
  }

  private runCommand(file: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
      execFile(file, args, (error, stdout) => {
        if (error) {
          resolve("");
          return;
        }

        resolve(stdout.toString());
      });
    });
  }

  private extractPortFromCommand(commandLine: string): number | undefined {
    const patterns = [
      /_EXTENSION_OPENCODE_PORT(?:=|\s+)(\d{2,5})/i,
      /--port(?:=|\s+)(\d{2,5})/i,
      /--http-port(?:=|\s+)(\d{2,5})/i,
      /localhost:(\d{2,5})/i,
    ];

    for (const pattern of patterns) {
      const match = commandLine.match(pattern);
      if (!match) {
        continue;
      }

      const port = Number(match[1]);
      if (this.isEphemeralPort(port)) {
        return port;
      }
    }

    return undefined;
  }

  private filterByWorkspace(instances: OpenCodeInstance[]): OpenCodeInstance[] {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      return instances;
    }

    const target = this.normalizePath(workspacePath);
    const matched = instances.filter((instance) => {
      if (!instance.workspacePath) {
        return false;
      }

      return this.normalizePath(instance.workspacePath) === target;
    });

    return matched;
  }

  private async waitForSpawnReadiness(port: number): Promise<boolean> {
    for (let attempt = 1; attempt <= SPAWN_HEALTH_RETRIES; attempt++) {
      if (this.disposed) {
        return false;
      }

      try {
        const healthy = await this.healthCheck(port);
        if (healthy) {
          return true;
        }
      } catch (error) {
        void error;
      }

      if (attempt < SPAWN_HEALTH_RETRIES) {
        await this.sleep(SPAWN_HEALTH_DELAY_MS);
      }
    }

    return false;
  }

  private parseCommand(
    commandLine: string,
  ): { file: string; args: string[] } | undefined {
    const tokens: string[] = [];
    let current = "";
    let quote: '"' | "'" | undefined;

    for (let i = 0; i < commandLine.length; i++) {
      const char = commandLine[i];

      if (char === "\\") {
        const nextChar = commandLine[i + 1];
        if (quote && (nextChar === quote || nextChar === "\\")) {
          current += nextChar;
          i++;
          continue;
        }

        if (
          !quote &&
          (nextChar === "'" || nextChar === '"' || /\s/.test(nextChar ?? ""))
        ) {
          current += nextChar;
          i++;
          continue;
        }

        current += char;
        continue;
      }

      if (quote) {
        if (char === quote) {
          quote = undefined;
          continue;
        }

        current += char;
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (/\s/.test(char)) {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }
        continue;
      }

      current += char;
    }

    if (quote) {
      return undefined;
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    if (tokens.length === 0) {
      return undefined;
    }

    return {
      file: tokens[0],
      args: tokens.slice(1),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizePath(pathValue: string): string {
    return (
      normalizeComparablePath(
        pathValue,
        { caseFolding: "win32-only" },
        this.getPlatform(),
      ) ?? ""
    );
  }

  private generateEphemeralPort(): number {
    return Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
  }

  private isEphemeralPort(port: number): boolean {
    return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
  }
}
