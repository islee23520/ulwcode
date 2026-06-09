export const TMUX_WEBVIEW_COMMAND_IDS = [
  "ulw.browseTmuxSessions",
  "ulw.openNewSessionTerminalInEditor",
  "ulw.createTmuxSession",
  "ulw.tmuxSwitchPane",
  "ulw.tmuxCreateWindow",
  "ulw.tmuxNextWindow",
  "ulw.tmuxPrevWindow",
  "ulw.tmuxSelectWindow",
  "ulw.tmuxKillWindow",
  "ulw.tmuxSplitPaneH",
  "ulw.tmuxSplitPaneV",
  "ulw.tmuxSplitPaneWithCommand",
  "ulw.tmuxSendTextToPane",
  "ulw.tmuxResizePane",
  "ulw.tmuxSwapPane",
  "ulw.tmuxKillPane",
  "ulw.tmuxKillSession",
  "ulw.tmuxRefresh",
] as const;

export type TmuxWebviewCommandId = (typeof TMUX_WEBVIEW_COMMAND_IDS)[number];

export const TMUX_RAW_ALLOWED_SUBCOMMANDS = [
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
] as const;

export type TmuxRawSubcommand = (typeof TMUX_RAW_ALLOWED_SUBCOMMANDS)[number];

export interface DroppedBlobFile {
  name: string;
  data: string;
}

export type TerminalBackendType = "native" | "tmux" | "zellij";

export type PaneLayout = {
  tabId: string;
  paneId: string;
  splitDirection?: "horizontal" | "vertical";
  size?: number;
  children?: PaneLayout[];
};

export type PaneConfig = {
  paneId: string;
  command?: string;
  cwd?: string;
  backend?: TerminalBackendType;
  backendConfig?: BackendPaneConfig;
};

export interface BackendPaneConfig {
  tmux?: { sessionId?: string; paneId?: string };
  zellij?: { sessionId?: string };
  native?: Record<string, never>;
}

export interface TerminalBackendAvailability {
  native: boolean;
  tmux: boolean;
  zellij: boolean;
}

export type WebviewMessage =
  | { type: "terminalInput"; data: string; paneId?: string }
  | { type: "terminalResize"; cols: number; rows: number; paneId?: string }
  | {
      type: "switchKeyboardInputSource";
      target: "english" | "korean";
      paneId?: string;
    }
  | { type: "listTerminals"; paneId?: string }
  | {
      type: "openFile";
      path: string;
      line?: number;
      endLine?: number;
      column?: number;
      paneId?: string;
    }
  | { type: "openUrl"; url: string; paneId?: string }
  | { type: "ready"; cols: number; rows: number; paneId?: string }
  | {
      type: "filesDropped";
      files: string[];
      shiftKey: boolean;
      dropCell?: { col: number; row: number };
      blobFiles?: DroppedBlobFile[];
      paneId?: string;
    }
  | { type: "setClipboard"; text: string; paneId?: string }
  | { type: "triggerPaste"; paneId?: string }
  | { type: "imagePasted"; data: string; paneId?: string }
  | { type: "switchSession"; sessionId: string; paneId?: string }
  | { type: "killSession"; sessionId: string; paneId?: string }
  | { type: "createTmuxSession"; paneId?: string }
  | {
      type: "launchAiTool";
      sessionId: string;
      tool: string;
      savePreference: boolean;
      targetPaneId?: string;
      paneId?: string;
    }
  | { type: "zoomTmuxPane"; paneId?: string }
  | { type: "toggleDashboard"; paneId?: string }
  | { type: "toggleEditorAttachment"; paneId?: string }
  | {
      type: "sendTmuxPromptChoice";
      choice: "tmux" | "shell" | "zellij";
      paneId?: string;
    }
  | {
      type: "selectTerminalBackend";
      backend: TerminalBackendType;
      paneId?: string;
    }
  | {
      type: "paneSwitchBackend";
      paneId: string;
      backend: TerminalBackendType;
    }
  | { type: "cycleTerminalBackend"; paneId?: string }
  | {
      type: "executeTmuxCommand";
      commandId: TmuxWebviewCommandId;
      paneId?: string;
    }
  | {
      type: "executeTmuxRawCommand";
      subcommand: TmuxRawSubcommand;
      args?: string[];
      paneId?: string;
    }
  | { type: "requestRestart"; paneId?: string }
  | {
      type: "paneCreate";
      direction?: "horizontal" | "vertical";
      paneId?: string;
    }
  | { type: "paneDelete"; paneId?: string };

export type AiTool = string;

export interface AiToolConfig {
  name: string;
  label: string;
  path: string;
  args: string[];
  aliases?: string[];
  operator?: string;
}

export const DEFAULT_AI_TOOLS: readonly AiToolConfig[] = [
  {
    name: "opencode",
    label: "OpenCode",
    path: "",
    args: ["-c"],
    aliases: [],
    operator: "opencode",
  },
  {
    name: "claude",
    label: "Claude Code",
    path: "",
    args: [],
    aliases: ["claude"],
    operator: "claude",
  },
  {
    name: "codex",
    label: "Codex",
    path: "",
    args: [],
    aliases: [],
    operator: "codex",
  },
] as const;

export function resolveAiToolConfigs(
  userTools: readonly unknown[],
): AiToolConfig[] {
  if (!Array.isArray(userTools) || userTools.length === 0) {
    return [...DEFAULT_AI_TOOLS];
  }
  return userTools
    .filter(
      (t): t is Record<string, unknown> =>
        t !== null &&
        typeof t === "object" &&
        typeof (t as Record<string, unknown>).name === "string" &&
        typeof (t as Record<string, unknown>).label === "string",
    )
    .map((t) => ({
      name: String(t.name),
      label: String(t.label),
      path: typeof t.path === "string" ? t.path : "",
      args: Array.isArray(t.args) ? t.args.map(String) : [],
      aliases: Array.isArray(t.aliases) ? t.aliases.map(String) : undefined,
      operator: typeof t.operator === "string" ? t.operator : undefined,
    }));
}

export function getToolLaunchCommand(tool: AiToolConfig): string {
  const exe = tool.path || tool.name;
  const args = tool.args.length > 0 ? ` ${tool.args.join(" ")}` : "";
  return exe + args;
}

export function getToolDetectionPatterns(tool: AiToolConfig): string[] {
  const patterns = new Set<string>([tool.name, `${tool.name}.exe`]);
  if (tool.operator) {
    patterns.add(tool.operator);
    patterns.add(`${tool.operator}.exe`);
  }
  for (const alias of tool.aliases ?? []) {
    patterns.add(alias);
    patterns.add(`${alias}.exe`);
  }
  patterns.add(tool.label);
  if (tool.path) {
    const basename = tool.path
      .split("/")
      .pop()
      ?.split("\\")
      .pop()
      ?.replace(/\.exe$/i, "");
    if (basename && basename !== tool.name) {
      patterns.add(basename);
    }
  }
  return Array.from(patterns);
}

export function detectAiToolName(
  text: string | undefined,
  tools: readonly AiToolConfig[],
): string | undefined {
  const haystack = text?.toLowerCase();
  if (!haystack) {
    return undefined;
  }

  for (const tool of tools) {
    const patterns = getToolDetectionPatterns(tool).map((pattern) =>
      pattern.toLowerCase(),
    );
    if (patterns.some((pattern) => pattern && haystack.includes(pattern))) {
      return tool.name;
    }
  }

  return undefined;
}

export type NativeShellDto = {
  id: string;
  label?: string;
  workspaceUri?: string;
  state: string;
  isActive: boolean;
};

export type ThreadHistoryEntryDto = {
  id: string;
  kind: "agent" | "terminal";
  title: string;
  titleOverride?: string;
  sessionId?: string;
  terminalId?: string;
  workspaceUri?: string;
  workspaceName?: string;
  updatedAt: string;
  createdAt: string;
  status: "running" | "completed" | "waiting" | "error";
  archived?: boolean;
};

export type ThreadHistoryProjectDto = {
  workspaceName: string;
  workspaceUri?: string;
  entries: ThreadHistoryEntryDto[];
};

export type ThreadHistoryBucketDto = {
  bucket: "today" | "yesterday" | "thisWeek" | "pastWeek" | "older";
  entries: ThreadHistoryEntryDto[];
};

export type ThreadHistoryDashboardDto = {
  active: ThreadHistoryEntryDto[];
  projects: ThreadHistoryProjectDto[];
  buckets: ThreadHistoryBucketDto[];
  archivedOnly?: boolean;
};

export type TmuxDashboardActionMessage =
  | { action: "refresh" }
  | { action: "toggleScope" }
  | { action: "toggleThreadHistory" }
  | { action: "archiveThread"; threadId: string }
  | { action: "restoreThread"; threadId: string }
  | { action: "deleteThread"; threadId: string }
  | { action: "create" }
  | { action: "createNativeShell" }
  | { action: "switchNativeShell" }
  | { action: "activateNativeShell"; instanceId: string; workspaceUri?: string }
  | { action: "killNativeShell"; instanceId: string }
  | { action: "activate"; sessionId: string; workspaceUri?: string }
  | {
      action: "launchDefaultAiTool";
      sessionId: string;
      sessionName: string;
      targetPaneId?: string;
    }
  | { action: "expandPanes"; sessionId: string }
  | { action: "createWindow"; sessionId: string }
  | { action: "nextWindow"; sessionId: string }
  | { action: "prevWindow"; sessionId: string }
  | { action: "killWindow"; sessionId: string; windowId: string }
  | { action: "killSession"; sessionId: string }
  | { action: "selectWindow"; sessionId: string; windowId: string }
  | {
      action: "switchPane";
      sessionId: string;
      paneId: string;
      windowId?: string;
    }
  | {
      action: "splitPane";
      sessionId: string;
      paneId?: string;
      direction: "h" | "v";
    }
  | {
      action: "splitPaneWithCommand";
      sessionId: string;
      paneId?: string;
      direction: "h" | "v";
      command: string;
    }
  | { action: "killPane"; sessionId: string; paneId: string }
  | {
      action: "resizePane";
      sessionId: string;
      paneId: string;
      direction: string;
      amount: number;
    }
  | {
      action: "swapPane";
      sessionId: string;
      sourcePaneId: string;
      targetPaneId: string;
    }
  | {
      action: "launchAiTool";
      sessionId: string;
      tool: string;
      savePreference: boolean;
      targetPaneId?: string;
    };

export type TmuxDashboardSessionDto = {
  id: string;
  name: string;
  workspace: string;
  workspaceUri?: string;
  isActive: boolean;
  paneCount?: number;
  preview?: string;
};

export type TmuxDashboardPaneDto = {
  paneId: string;
  index: number;
  title: string;
  isActive: boolean;
  currentCommand?: string;
  panePid?: number;
  resolvedTool?: string;
  windowId?: string;
  currentPath?: string;
  paneLeft?: number;
  paneTop?: number;
  paneWidth?: number;
  paneHeight?: number;
};

export type TmuxDashboardWindowDto = {
  windowId: string;
  index: number;
  name: string;
  isActive: boolean;
  panes: TmuxDashboardPaneDto[];
};

export type TmuxDashboardHostMessage = {
  type: "updateTmuxSessions";
  sessions: TmuxDashboardSessionDto[];
  nativeShells?: NativeShellDto[];
  threadHistory?: ThreadHistoryDashboardDto;
  showingThreadHistory?: boolean;
  workspace: string;
  workspaceUri?: string;
  windows?: Record<string, TmuxDashboardWindowDto[]>;
  panes?: Record<string, TmuxDashboardPaneDto[]>;
  showingAll?: boolean;
  tools?: AiToolConfig[];
  tmuxAvailable?: boolean;
};

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export interface TmuxSession {
  id: string;
  name: string;
  workspace: string;
  isActive: boolean;
}

export interface TreeSnapshot {
  type: "treeSnapshot";
  sessions: TmuxSession[];
  activeSessionId: string | null;
  emptyState?: "no-workspace" | "no-tmux" | "no-sessions";
}

export type TmuxPaneSyncMessage = {
  paneId: string;
  tmuxPaneId: string;
  action: "created" | "removed" | "resized";
};

export type HostMessage =
  | { type: "requestPaste" }
  | { type: "clipboardContent"; text: string }
  | { type: "terminalList"; terminals: Array<{ name: string; cwd: string }> }
  | { type: "terminalOutput"; data: string; paneId?: string }
  | { type: "terminalExited"; paneId?: string }
  | { type: "clearTerminal"; paneId?: string }
  | { type: "focusTerminal"; paneId?: string }
  | { type: "webviewVisible"; paneId?: string }
  | {
      type: "platformInfo";
      platform: string;
      tmuxAvailable?: boolean;
      zellijAvailable?: boolean;
      backendAvailability?: TerminalBackendAvailability;
      activeBackend?: TerminalBackendType;
    }
  | {
      type: "terminalConfig";
      fontSize: number;
      fontFamily: string;
      cursorBlink: boolean;
      cursorStyle: "block" | "underline" | "bar";
      scrollback: number;
      sendKeybindingsToShell?: boolean;
      autoSwitchKoreanKeyboard?: boolean;
      showTmuxWindowControls?: boolean;
      renderer?: "webgl" | "canvas" | "auto";
    }
  | {
      type: "activeSession";
      sessionName: string;
      sessionId: string;
      paneId?: string;
      windowIndex?: number;
      windowName?: string;
      canKillPane?: boolean;
      backend?: TerminalBackendType;
    }
  | { type: "activeSession"; backend?: TerminalBackendType; paneId?: string }
  | {
      type: "updateDashboard";
      sessions: TmuxDashboardSessionDto[];
      workspace: string;
      showingAll?: boolean;
    }
  | { type: "toggleDashboard"; visible: boolean }
  | { type: "toggleTmuxCommandToolbar" }
  | {
      type: "showTmuxPrompt";
      workspaceName: string;
      tmuxAvailable?: boolean;
      zellijAvailable?: boolean;
      activeBackend?: TerminalBackendType;
    }
  | {
      type: "paneCreate";
      direction?: "horizontal" | "vertical";
      paneId?: string;
    }
  | {
      type: "paneBackendChanged";
      paneId: string;
      backend: TerminalBackendType;
    }
  | { type: "paneDelete"; paneId?: string };

export type LogLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticSeverity = "error" | "warning" | "information" | "hint";

export interface ExtensionConfig {
  autoStart: boolean;
  command: string;
  fontSize: number;
  fontFamily: string;
  cursorBlink: boolean;
  cursorStyle: "block" | "underline" | "bar";
  scrollback: number;
  autoFocusOnSend: boolean;
  autoStartOnOpen: boolean;
  shellPath: string;
  shellArgs: string[];
  autoShareContext: boolean;
  httpTimeout: number;
  enableHttpApi: boolean;
  logLevel: LogLevel;
  contextDebounceMs: number;
  maxDiagnosticLength: number;
  enableAutoSpawn: boolean;
  codeActionSeverities: DiagnosticSeverity[];
  collapseSecondaryBarOnEditorOpen: boolean;
  terminalBackend: TerminalBackendType;
  showTmuxWindowControls: boolean;
  "pane.defaultSplitDirection": "horizontal" | "vertical";
  "pane.focusOnClick": boolean;
  "pane.showPaneActions": boolean;
  "pane.renderer": "webgl" | "canvas" | "auto";
}
