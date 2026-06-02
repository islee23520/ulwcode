import * as AiTool from "../ai-tool-selector";

type AiToolConfig = AiTool.AiToolConfig;

export interface TmuxDashboardSessionDto {
  id: string;
  name: string;
  workspace: string;
  workspaceUri?: string;
  isActive: boolean;
  paneCount?: number;
  preview?: string;
}

export interface TmuxDashboardPaneDto {
  paneId: string;
  index: number;
  title: string;
  isActive: boolean;
  currentCommand?: string;
  resolvedTool?: string;
  windowId?: string;
  currentPath?: string;
  paneLeft?: number;
  paneTop?: number;
  paneWidth?: number;
  paneHeight?: number;
}

export interface TmuxDashboardWindowDto {
  windowId: string;
  index: number;
  name: string;
  isActive: boolean;
  panes: TmuxDashboardPaneDto[];
}

export interface DashboardPayload {
  sessions: TmuxDashboardSessionDto[];
  nativeShells?: NativeShellDto[];
  threadHistory?: ThreadHistoryDashboardDto;
  showingThreadHistory?: boolean;
  workspace: string;
  workspaceUri?: string;
  windows?: Record<string, TmuxDashboardWindowDto[]>;
  showingAll?: boolean;
  tools?: AiToolConfig[];
  tmuxAvailable?: boolean;
}

export interface NativeShellDto {
  id: string;
  label?: string;
  workspaceUri?: string;
  state: string;
  isActive: boolean;
}

export interface ThreadHistoryEntryDto {
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
}

export interface ThreadHistoryProjectDto {
  workspaceName: string;
  workspaceUri?: string;
  entries: ThreadHistoryEntryDto[];
}

export interface ThreadHistoryBucketDto {
  bucket: "today" | "yesterday" | "thisWeek" | "pastWeek" | "older";
  entries: ThreadHistoryEntryDto[];
}

export interface ThreadHistoryDashboardDto {
  active: ThreadHistoryEntryDto[];
  projects: ThreadHistoryProjectDto[];
  buckets: ThreadHistoryBucketDto[];
  archivedOnly?: boolean;
}

export interface HostMessage {
  type: string;
  sessions?: TmuxDashboardSessionDto[];
  nativeShells?: NativeShellDto[];
  threadHistory?: ThreadHistoryDashboardDto;
  showingThreadHistory?: boolean;
  workspace?: string;
  workspaceUri?: string;
  windows?: Record<string, TmuxDashboardWindowDto[]>;
  showingAll?: boolean;
  tools?: AiToolConfig[];
  tmuxAvailable?: boolean;
  sessionId?: string;
  sessionName?: string;
  defaultTool?: string;
}
