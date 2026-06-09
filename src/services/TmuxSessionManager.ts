import { execFile } from "node:child_process";
import { basename } from "node:path";
import * as vscode from "vscode";
import {
  AiToolConfig,
  detectAiToolName,
  TmuxDashboardPaneDto,
  TmuxSession,
  TreeSnapshot,
} from "../types";
import { ILogger } from "./ILogger";
import { normalizeComparablePath } from "../utils/pathUtils";

const TMUX_LIST_FORMAT =
  "#{session_name}\t#{session_attached}\t#{session_path}";

const TMUX_RAW_ALLOWED_SUBCOMMANDS = [
  "rename-session",
  "rename-window",
  "last-window",
  "last-pane",
  "rotate-window",
  "select-layout",
  "display-panes",
  "copy-mode",
  "clear-history",
  "detach-client",
  "move-window",
  "move-pane",
  "respawn-pane",
  "choose-tree",
  "list-panes",
  "split-pane",
  "kill-pane",
] as const;

type TmuxRawAllowedSubcommand = (typeof TMUX_RAW_ALLOWED_SUBCOMMANDS)[number];

interface ExecError extends Error {
  code?: number | string;
  stderr?: string;
}

type ExecFileCallback = (
  error: ExecError | null,
  stdout: string,
  stderr: string,
) => void;

type ExecFileLike = (
  file: string,
  args: string[],
  callback: ExecFileCallback,
) => void;

interface DiscoveredSession {
  session: TmuxSession;
  workspacePath: string | undefined;
}

export interface TmuxPane {
  paneId: string;
  index: number;
  title: string;
  isActive: boolean;
  currentCommand?: string;
  windowId?: string;
  currentPath?: string;
}

export interface TmuxPaneGeometry {
  paneId: string;
  paneLeft: number;
  paneTop: number;
  paneWidth: number;
  paneHeight: number;
}

interface TmuxWindow {
  windowId: string;
  index: number;
  name: string;
  isActive: boolean;
}

export class TmuxUnavailableError extends Error {
  constructor(message: string = "tmux is not installed") {
    super(message);
    this.name = "TmuxUnavailableError";
  }
}

interface EnsureTmuxSessionResult {
  action: "attached" | "created";
  session: TmuxSession;
}

export class TmuxSessionManager {
  private readonly _onPaneChanged = new vscode.EventEmitter<void>();
  public readonly onPaneChanged = this._onPaneChanged.event;
  private readonly _onExternalPaneChange = new vscode.EventEmitter<string>();
  public readonly onExternalPaneChange = this._onExternalPaneChange.event;

  constructor(
    private readonly logger?: ILogger,
    private readonly runExecFile: ExecFileLike = (file, args, callback) => {
      execFile(file, args, callback as never);
    },
  ) {}

  public dispose(): void {
    this._onPaneChanged.dispose();
    this._onExternalPaneChange.dispose();
  }

  public notifyExternalChange(sessionId: string): void {
    this._onExternalPaneChange.fire(sessionId);
  }

  public async isAvailable(): Promise<boolean> {
    try {
      await this.runTmux(["-V"]);
      return true;
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        return false;
      }

      throw error;
    }
  }

  public async discoverSessions(): Promise<TmuxSession[]> {
    const discoveredSessions = await this.discoverSessionDetails();
    return discoveredSessions.map(({ session }) => session);
  }

  private async discoverSessionDetails(): Promise<DiscoveredSession[]> {
    try {
      const stdout = await this.runTmux([
        "list-sessions",
        "-F",
        TMUX_LIST_FORMAT,
      ]);
      return this.parseSessions(stdout);
    } catch (error) {
      if (this.isNoSessionsError(error)) {
        return [];
      }

      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  public async createTreeSnapshot(
    activeSessionId: string | null = null,
  ): Promise<TreeSnapshot> {
    try {
      const sessions = await this.discoverSessions();
      const resolvedActiveSessionId =
        activeSessionId ??
        sessions.find((session) => session.isActive)?.id ??
        null;

      return {
        type: "treeSnapshot",
        sessions,
        activeSessionId: resolvedActiveSessionId,
        emptyState: sessions.length === 0 ? "no-sessions" : undefined,
      };
    } catch (error) {
      if (error instanceof TmuxUnavailableError) {
        return {
          type: "treeSnapshot",
          sessions: [],
          activeSessionId: null,
          emptyState: "no-tmux",
        };
      }

      throw error;
    }
  }

  public async ensureSession(
    sessionName: string,
    workspacePath: string,
  ): Promise<EnsureTmuxSessionResult> {
    const discoveredSessions = await this.discoverSessionDetails();
    const existingSession = this.selectWorkspaceSession(
      discoveredSessions,
      workspacePath,
      sessionName,
    );

    if (existingSession) {
      return {
        action: "attached",
        session: {
          ...existingSession,
          isActive: true,
        },
      };
    }

    const existingSessionNames = new Set(
      discoveredSessions.map(({ session }) => session.id),
    );
    const sessionNameForCreate = this.resolveCollisionSafeSessionName(
      sessionName,
      existingSessionNames,
    );

    await this.createSession(sessionNameForCreate, workspacePath);
    return {
      action: "created",
      session: {
        id: sessionNameForCreate,
        name: sessionNameForCreate,
        workspace: this.resolveWorkspaceName(
          workspacePath,
          sessionNameForCreate,
        ),
        isActive: true,
      },
    };
  }

  public async findSessionForWorkspace(
    workspacePath: string,
    preferredSessionName?: string,
  ): Promise<TmuxSession | undefined> {
    const discoveredSessions = await this.discoverSessionDetails();
    return this.selectWorkspaceSession(
      discoveredSessions,
      workspacePath,
      preferredSessionName,
    );
  }

  public async attachSession(sessionName: string): Promise<void> {
    try {
      await this.runTmux(["attach-session", "-t", sessionName]);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  public async createSession(
    sessionName: string,
    workspacePath: string,
  ): Promise<void> {
    try {
      await this.runTmux([
        "new-session",
        "-d",
        "-s",
        sessionName,
        "-c",
        workspacePath,
      ]);
      await this.configureMouseAndClipboard(sessionName);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  public async createGroupedSession(
    sourceSessionId: string,
    groupedSessionId: string,
    workspacePath: string,
  ): Promise<void> {
    try {
      await this.runTmux([
        "new-session",
        "-d",
        "-t",
        sourceSessionId,
        "-s",
        groupedSessionId,
        "-c",
        workspacePath,
      ]);
      await this.configureMouseAndClipboard(groupedSessionId);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  public async executeRawCommand(
    sessionId: string,
    tmuxSubcommand: string,
    args: string[] = [],
  ): Promise<string> {
    if (!this.isAllowedRawSubcommand(tmuxSubcommand)) {
      throw new Error(`Unsupported tmux subcommand: ${tmuxSubcommand}`);
    }

    const tmuxArgs = this.buildRawTmuxCommandArgs(
      sessionId,
      tmuxSubcommand,
      args,
    );

    try {
      return await this.runTmux(tmuxArgs);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  public async showBuffer(): Promise<string> {
    try {
      return await this.runTmux(["show-buffer"]);
    } catch {
      return "";
    }
  }

  public async setMouseOn(sessionId: string): Promise<void> {
    try {
      await this.runTmux(["set-option", "-t", sessionId, "mouse", "on"]);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  public async configureMouseAndClipboard(sessionId: string): Promise<void> {
    try {
      await this.runTmux(["set-option", "-t", sessionId, "mouse", "on"]);
      await this.runTmux(["set-option", "-t", sessionId, "set-clipboard", "on"]);
      await this.runTmux([
        "bind-key",
        "-T",
        "copy-mode",
        "MouseDragEnd1Pane",
        "send-keys",
        "-X",
        "copy-selection-and-cancel",
      ]);
      await this.runTmux([
        "bind-key",
        "-T",
        "copy-mode-vi",
        "MouseDragEnd1Pane",
        "send-keys",
        "-X",
        "copy-selection-and-cancel",
      ]);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  public async registerSessionHooks(
    sessionId: string,
    signalPid: number,
  ): Promise<void> {
    try {
      await this.runTmux([
        "set-hook",
        "-g",
        "-t",
        sessionId,
        "after-split-window",
        this.buildHookCommand(signalPid),
      ]);
      await this.runTmux([
        "set-hook",
        "-g",
        "-t",
        sessionId,
        "after-new-window",
        this.buildHookCommand(signalPid),
      ]);
      await this.runTmux([
        "set-hook",
        "-g",
        "-t",
        sessionId,
        "after-select-window",
        this.buildHookCommand(signalPid),
      ]);
    } catch (error) {
      try {
        if (this.isTmuxUnavailable(error)) {
          throw new TmuxUnavailableError();
        }

        throw error;
      } catch (hookError) {
        this.logger?.warn(
          `[TmuxSessionManager] Failed to register session hooks for "${sessionId}": ${hookError instanceof Error ? hookError.message : String(hookError)}`,
        );
      }
    }
  }

  public async unregisterSessionHooks(sessionId: string): Promise<void> {
    try {
      await this.runTmux([
        "set-hook",
        "-u",
        "-g",
        "-t",
        sessionId,
        "after-split-window",
      ]);
      await this.runTmux([
        "set-hook",
        "-u",
        "-g",
        "-t",
        sessionId,
        "after-new-window",
      ]);
      await this.runTmux([
        "set-hook",
        "-u",
        "-g",
        "-t",
        sessionId,
        "after-select-window",
      ]);
    } catch (error) {
      try {
        if (this.isTmuxUnavailable(error)) {
          throw new TmuxUnavailableError();
        }

        throw error;
      } catch (hookError) {
        this.logger?.warn(
          `[TmuxSessionManager] Failed to unregister session hooks for "${sessionId}": ${hookError instanceof Error ? hookError.message : String(hookError)}`,
        );
      }
    }
  }

  public async killSession(sessionName: string): Promise<void> {
    try {
      await this.runTmux(["kill-session", "-t", sessionName]);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  public async createWindow(
    sessionId: string,
    workingDirectory?: string,
  ): Promise<{ windowId: string; paneId: string }> {
    try {
      const args = [
        "new-window",
        "-t",
        sessionId,
        "-P",
        "-F",
        "#{window_id}:#{pane_id}",
      ];
      if (workingDirectory) {
        args.push("-c", workingDirectory);
      }
      const stdout = await this.runTmux(args);
      this._onPaneChanged.fire();
      const [windowId, paneId] = stdout.trim().split(":");
      if (!windowId || !paneId) {
        throw new Error("Failed to get window/pane ID from new-window output");
      }
      return { windowId, paneId };
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async nextWindow(sessionId: string): Promise<void> {
    try {
      await this.runTmux(["next-window", "-t", sessionId]);
      this._onPaneChanged.fire();
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async prevWindow(sessionId: string): Promise<void> {
    try {
      await this.runTmux(["previous-window", "-t", sessionId]);
      this._onPaneChanged.fire();
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async killWindow(windowId: string): Promise<void> {
    try {
      await this.runTmux(["kill-window", "-t", windowId]);
      this._onPaneChanged.fire();
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async splitPane(
    targetPaneId: string,
    direction: "h" | "v",
    options?: { command?: string; workingDirectory?: string },
  ): Promise<string> {
    try {
      const args = [
        "split-window",
        "-t",
        targetPaneId,
        `-${direction}`,
        "-P",
        "-F",
        "#{pane_id}",
      ];
      if (options?.workingDirectory) {
        args.push("-c", options.workingDirectory);
      }
      if (options?.command) {
        args.push(options.command);
      }
      this.logger?.debug(
        `[DIAG:splitPane] targetPaneId="${targetPaneId}" direction="${direction}" command="${options?.command ?? "none"}" args=${JSON.stringify(args)}`,
      );
      const stdout = await this.runTmux(args);
      const newPaneId = stdout.trim();
      this.logger?.debug(`[DIAG:splitPane] SUCCESS newPaneId="${newPaneId}"`);
      this._onPaneChanged.fire();
      return newPaneId;
    } catch (error) {
      this.logger?.error(
        `[DIAG:splitPane] FAILED targetPaneId="${targetPaneId}" error=${error instanceof Error ? error.message : String(error)}`,
      );
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async killPane(paneId: string): Promise<void> {
    try {
      this.logger?.debug(`[DIAG:killPane] paneId="${paneId}"`);
      await this.runTmux(["kill-pane", "-t", paneId]);
      this.logger?.debug(`[DIAG:killPane] SUCCESS paneId="${paneId}"`);
      this._onPaneChanged.fire();
    } catch (error) {
      this.logger?.error(
        `[DIAG:killPane] FAILED paneId="${paneId}" error=${error instanceof Error ? error.message : String(error)}`,
      );
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async selectWindow(windowId: string): Promise<void> {
    try {
      await this.runTmux(["select-window", "-t", windowId]);
      this._onPaneChanged.fire();
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async selectPane(paneId: string, windowId?: string): Promise<void> {
    try {
      this.logger?.debug(
        `[DIAG:selectPane] paneId="${paneId}" windowId="${windowId ?? "none"}"`,
      );
      if (windowId) {
        await this.runTmux(["select-window", "-t", windowId]);
      }
      await this.runTmux(["select-pane", "-t", paneId]);
      this.logger?.debug(
        `[DIAG:selectPane] SUCCESS paneId="${paneId}" windowId="${windowId ?? "none"}"`,
      );
      this._onPaneChanged.fire();
    } catch (error) {
      this.logger?.error(
        `[DIAG:selectPane] FAILED paneId="${paneId}" windowId="${windowId ?? "none"}" error=${error instanceof Error ? error.message : String(error)}`,
      );
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async resizePane(
    paneId: string,
    direction: "L" | "R" | "U" | "D",
    adjustment: number,
  ): Promise<void> {
    try {
      await this.runTmux([
        "resize-pane",
        "-t",
        paneId,
        `-${direction}`,
        String(adjustment),
      ]);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async zoomPane(paneId: string): Promise<void> {
    try {
      await this.runTmux(["resize-pane", "-Z", "-t", paneId]);
      this._onPaneChanged.fire();
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async swapPanes(
    sourcePaneId: string,
    targetPaneId: string,
  ): Promise<void> {
    try {
      await this.runTmux(["swap-pane", "-s", sourcePaneId, "-t", targetPaneId]);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async sendTextToPane(
    paneId: string,
    text: string,
    options?: { submit?: boolean },
  ): Promise<void> {
    try {
      const submit = options?.submit !== false;
      this.logger?.debug(
        `[DIAG:sendTextToPane] paneId="${paneId}" textLength=${text.length} submit=${submit}`,
      );
      const args: string[] = ["send-keys", "-t", paneId];
      if (submit) {
        args.push(text, "C-m");
      } else {
        args.push("-l", text);
      }
      await this.runTmux(args);
      this.logger?.debug(`[DIAG:sendTextToPane] SUCCESS paneId="${paneId}"`);
    } catch (error) {
      this.logger?.error(
        `[DIAG:sendTextToPane] FAILED paneId="${paneId}" error=${error instanceof Error ? error.message : String(error)}`,
      );
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async listWindows(sessionId: string): Promise<TmuxWindow[]> {
    try {
      const format =
        "#{window_id}\t#{window_index}\t#{window_name}\t#{window_active}";
      const stdout = await this.runTmux([
        "list-windows",
        "-t",
        sessionId,
        "-F",
        format,
      ]);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [windowId, index, name, active] = line.split("\t");
          return {
            windowId: windowId ?? "",
            index: Number(index),
            name: name ?? "",
            isActive: active === "1",
          };
        });
    } catch (error) {
      if (this.isNoSessionsError(error)) {
        return [];
      }
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async listPanes(
    sessionId: string,
    options?: { activeWindowOnly?: boolean },
  ): Promise<TmuxPane[]> {
    try {
      const format =
        "#{pane_id}\t#{pane_index}\t#{pane_title}\t#{pane_active}\t#{pane_current_command}\t#{pane_pid}\t#{window_id}\t#{pane_current_path}";
      const args = ["list-panes"];
      if (options?.activeWindowOnly) {
        const windows = await this.listWindows(sessionId);
        const activeWindow = windows.find((w) => w.isActive);
        if (!activeWindow) {
          return [];
        }
        args.push("-t", `${sessionId}:${activeWindow.windowId}`);
      } else {
        args.push("-s", "-t", sessionId);
      }
      args.push("-F", format);
      const stdout = await this.runTmux(args);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [
            paneId,
            index,
            title,
            active,
            currentCommand,
            _panePid,
            windowId,
            currentPath,
          ] = line.split("\t");
          return {
            paneId: paneId ?? "",
            index: Number(index),
            title: title ?? "",
            isActive: active === "1",
            ...(currentCommand !== undefined
              ? { currentCommand: currentCommand ?? "" }
              : {}),
            ...(windowId !== undefined ? { windowId: windowId ?? "" } : {}),
            ...(currentPath !== undefined
              ? { currentPath: currentPath ?? "" }
              : {}),
          };
        });
    } catch (error) {
      if (this.isNoSessionsError(error)) {
        return [];
      }
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async listVisiblePaneGeometry(
    sessionId: string,
  ): Promise<TmuxPaneGeometry[]> {
    try {
      const format =
        "#{pane_id}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}";
      const stdout = await this.runTmux([
        "list-panes",
        "-t",
        sessionId,
        "-F",
        format,
      ]);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [paneId, left, top, width, height] = line.split("\t");
          return {
            paneId: paneId ?? "",
            paneLeft: Number(left),
            paneTop: Number(top),
            paneWidth: Number(width),
            paneHeight: Number(height),
          };
        });
    } catch (error) {
      if (this.isNoSessionsError(error)) {
        return [];
      }
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  public async listPaneDtos(
    sessionId: string,
  ): Promise<TmuxDashboardPaneDto[]> {
    const panes = await this.listPanes(sessionId);
    return panes.map((p) => ({
      paneId: p.paneId,
      index: p.index,
      title: p.title,
      isActive: p.isActive,
      ...(p.currentCommand !== undefined
        ? { currentCommand: p.currentCommand }
        : {}),
      ...(p.windowId !== undefined ? { windowId: p.windowId } : {}),
      ...(p.currentPath !== undefined ? { currentPath: p.currentPath } : {}),
    }));
  }

  /**
   * Lists panes with geometry for a specific window in a session.
   * @param sessionId The session ID
   * @param windowId The window ID
   * @returns Array of pane DTOs with geometry fields populated
   */
  public async listWindowPaneGeometry(
    sessionId: string,
    windowId: string,
    tools: readonly AiToolConfig[] = [],
  ): Promise<TmuxDashboardPaneDto[]> {
    try {
      const format =
        "#{pane_id}\t#{pane_index}\t#{pane_title}\t#{pane_active}\t#{pane_current_command}\t#{pane_pid}\t#{window_id}\t#{pane_current_path}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}";
      const stdout = await this.runTmux([
        "list-panes",
        "-t",
        `${sessionId}:${windowId}`,
        "-F",
        format,
      ]);
      const panes = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [
            paneId,
            index,
            title,
            active,
            currentCommand,
            panePid,
            wid,
            currentPath,
            paneLeft,
            paneTop,
            paneWidth,
            paneHeight,
          ] = line.split("\t");
          return {
            paneId: paneId ?? "",
            index: Number(index),
            title: title ?? "",
            isActive: active === "1",
            ...(currentCommand !== undefined && currentCommand !== ""
              ? { currentCommand }
              : {}),
            ...(panePid !== undefined && panePid !== ""
              ? { panePid: Number(panePid) }
              : {}),
            ...(wid !== undefined && wid !== "" ? { windowId: wid } : {}),
            ...(currentPath !== undefined && currentPath !== ""
              ? { currentPath }
              : {}),
            paneLeft: Number(paneLeft),
            paneTop: Number(paneTop),
            paneWidth: Number(paneWidth),
            paneHeight: Number(paneHeight),
          };
        });
      const toolsArr = Array.isArray(tools) ? tools : [];

      const processMap = new Map<number, { ppid: number; command: string }>();
      if (process.platform !== "win32") {
        try {
          const psOutput = await new Promise<string>((resolve, reject) => {
            this.runExecFile(
              "ps",
              ["-ax", "-o", "pid=,ppid=,command="],
              (error, stdout) => {
                if (error) {
                  reject(error);
                } else {
                  resolve(stdout?.toString() ?? "");
                }
              },
            );
          });

          psOutput.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (trimmed.length === 0) return;
            const parts = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
            if (parts) {
              const pid = parseInt(parts[1], 10);
              const ppid = parseInt(parts[2], 10);
              const command = parts[3];
              processMap.set(pid, { ppid, command });
            }
          });
        } catch {
          // Ignore ps errors, just use currentCommand
        }
      }

      // Build child map: parentPid -> childPids[]
      const childMap = new Map<number, number[]>();
      processMap.forEach((info, pid) => {
        const children = childMap.get(info.ppid) || [];
        children.push(pid);
        childMap.set(info.ppid, children);
      });

      // Get all descendant commands recursively
      const getAllDescendantCommands = (parentPid: number): string[] => {
        const commands: string[] = [];
        const queue = [parentPid];
        const visited = new Set<number>();

        while (queue.length > 0) {
          const currentPid = queue.shift()!;
          if (visited.has(currentPid)) continue;
          visited.add(currentPid);

          const info = processMap.get(currentPid);
          if (info && currentPid !== parentPid) {
            commands.push(info.command);
          }

          const children = childMap.get(currentPid) || [];
          for (const child of children) {
            if (!visited.has(child)) {
              queue.push(child);
            }
          }
        }
        return commands;
      };

      const panesWithTools = panes.map((pane) => {
        let resolvedTool: string | undefined;

        // First check currentCommand
        if (pane.currentCommand) {
          resolvedTool = detectAiToolName(pane.currentCommand, toolsArr);
        }

        // If not found, check descendant processes
        if (!resolvedTool && pane.panePid && processMap.size > 0) {
          const descendantCommands = getAllDescendantCommands(pane.panePid);
          for (const cmd of descendantCommands) {
            resolvedTool = detectAiToolName(cmd, toolsArr);
            if (resolvedTool) break;
          }
        }

        return {
          ...pane,
          ...(resolvedTool ? { resolvedTool } : {}),
        };
      });
      return panesWithTools;
    } catch (error) {
      if (this.isNoSessionsError(error)) {
        return [];
      }
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      throw error;
    }
  }

  /**
   * Captures the visible content of a pane for preview.
   * @param paneId The pane ID to capture
   * @returns The captured pane content as a string
   */
  public async getActiveFocus(): Promise<
    { sessionId: string; windowId: string; paneId: string } | undefined
  > {
    try {
      const stdout = await this.runTmux([
        "display-message",
        "-p",
        "#{session_id}\t#{window_id}\t#{pane_id}",
      ]);
      const [sessionId, windowId, paneId] = stdout.trim().split("\t");
      if (!sessionId || !windowId || !paneId) return undefined;
      return { sessionId, windowId, paneId };
    } catch {
      return undefined;
    }
  }

  public async capturePane(paneId: string): Promise<string> {
    try {
      const stdout = await this.runTmux(["capture-pane", "-t", paneId, "-p"]);
      return stdout;
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      return "";
    }
  }

  /**
   * Captures preview content for the active pane of a session.
   * @param sessionId The session ID to capture preview for
   * @returns The captured preview content
   */
  public async captureSessionPreview(sessionId: string): Promise<string> {
    try {
      // Get the active pane in the session
      const stdout = await this.runTmux([
        "list-panes",
        "-t",
        sessionId,
        "-f",
        "#{pane_active}",
        "-F",
        "#{pane_id}",
      ]);
      const activePaneId = stdout.trim().split(/\r?\n/)[0];
      if (!activePaneId) {
        return "";
      }
      return this.capturePane(activePaneId);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }
      return "";
    }
  }

  private parseSessions(stdout: string): DiscoveredSession[] {
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        const [name, attachedCount, sessionPath] = line.split("\t");
        const trimmedName = name?.trim();

        if (!trimmedName) {
          return [];
        }

        return [
          {
            session: {
              id: trimmedName,
              name: trimmedName,
              workspace: this.resolveWorkspaceName(sessionPath, trimmedName),
              isActive: Number(attachedCount) > 0,
            },
            workspacePath: this.normalizeWorkspacePath(sessionPath),
          } satisfies DiscoveredSession,
        ];
      });
  }

  private pickPreferredSession(
    discoveredSessions: DiscoveredSession[],
    preferredName?: string,
  ): TmuxSession | undefined {
    if (discoveredSessions.length === 0) {
      return undefined;
    }

    if (preferredName) {
      const exactNameMatch = discoveredSessions.find(
        ({ session }) =>
          session.id === preferredName || session.name === preferredName,
      );
      if (exactNameMatch) {
        return exactNameMatch.session;
      }
    }

    const activeSession = discoveredSessions.find(
      ({ session }) => session.isActive,
    );
    if (activeSession) {
      return activeSession.session;
    }

    return discoveredSessions
      .slice()
      .sort((a, b) => a.session.id.localeCompare(b.session.id))[0]?.session;
  }

  private selectWorkspaceSession(
    discoveredSessions: DiscoveredSession[],
    workspacePath: string,
    preferredSessionName?: string,
  ): TmuxSession | undefined {
    const exactWorkspaceMatches = discoveredSessions.filter((entry) =>
      this.pathsMatch(entry.workspacePath, workspacePath),
    );

    return this.pickPreferredSession(
      exactWorkspaceMatches,
      preferredSessionName,
    );
  }

  private resolveCollisionSafeSessionName(
    requestedName: string,
    existingSessionNames: Set<string>,
  ): string {
    if (!existingSessionNames.has(requestedName)) {
      return requestedName;
    }

    let suffix = 2;
    while (existingSessionNames.has(`${requestedName}-${suffix}`)) {
      suffix += 1;
    }

    return `${requestedName}-${suffix}`;
  }

  private pathsMatch(
    discoveredWorkspacePath: string | undefined,
    requestedWorkspacePath: string,
  ): boolean {
    const normalizedDiscoveredPath = this.normalizeWorkspacePath(
      discoveredWorkspacePath,
    );
    const normalizedRequestedPath = this.normalizeWorkspacePath(
      requestedWorkspacePath,
    );

    if (!normalizedDiscoveredPath || !normalizedRequestedPath) {
      return false;
    }

    return normalizedDiscoveredPath === normalizedRequestedPath;
  }

  private normalizeWorkspacePath(
    workspacePath: string | undefined,
  ): string | undefined {
    return normalizeComparablePath(workspacePath, { resolveRelative: true });
  }

  private resolveWorkspaceName(
    workspacePath: string | undefined,
    fallbackName: string,
  ): string {
    if (!workspacePath) {
      return fallbackName;
    }

    const normalizedPath = workspacePath.trim().replace(/[\\/]+$/, "");
    return basename(normalizedPath) || fallbackName;
  }

  private buildHookCommand(signalPid: number): string {
    if (process.platform === "win32") {
      return `run-shell "echo noop"`;
    }
    return `run-shell "kill -USR2 ${signalPid} 2>/dev/null || true"`;
  }

  private isAllowedRawSubcommand(
    value: string,
  ): value is TmuxRawAllowedSubcommand {
    return TMUX_RAW_ALLOWED_SUBCOMMANDS.some((command) => command === value);
  }

  private buildRawTmuxCommandArgs(
    sessionId: string,
    tmuxSubcommand: TmuxRawAllowedSubcommand,
    args: string[],
  ): string[] {
    switch (tmuxSubcommand) {
      case "rename-session":
      case "rename-window":
      case "select-layout": {
        const firstArg = args[0]?.trim();
        if (!firstArg) {
          throw new Error(`${tmuxSubcommand} requires an argument`);
        }

        return [tmuxSubcommand, "-t", sessionId, firstArg];
      }
      case "respawn-pane":
        return [tmuxSubcommand, "-t", sessionId, "-k"];
      case "move-window":
      case "move-pane":
        return [tmuxSubcommand, "-t", sessionId, ...args];
      case "last-window":
      case "last-pane":
      case "rotate-window":
      case "display-panes":
      case "copy-mode":
      case "clear-history":
      case "detach-client":
      case "choose-tree":
        return [tmuxSubcommand, "-t", sessionId];
      case "list-panes":
      case "split-pane":
        return [tmuxSubcommand, "-t", sessionId, ...args];
      case "kill-pane":
        return [tmuxSubcommand, "-t", sessionId];
    }
  }

  private runTmux(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      this.runExecFile("tmux", args, (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }

        resolve(stdout.toString());
      });
    });
  }

  private isTmuxUnavailable(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const execError = error as ExecError;
    const message =
      `${execError.message} ${execError.stderr ?? ""}`.toLowerCase();
    return (
      execError.code === "ENOENT" ||
      (message.includes("tmux") && message.includes("not found"))
    );
  }

  private isNoSessionsError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const execError = error as ExecError;
    const message =
      `${execError.message} ${execError.stderr ?? ""}`.toLowerCase();
    return (
      message.includes("no server running") ||
      message.includes("failed to connect to server") ||
      message.includes("error connecting to") ||
      message.includes("no such file or directory") ||
      message.includes("no sessions")
    );
  }
}
