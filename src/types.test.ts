import { describe, it, expect } from "vitest";
import type {
  BackendPaneConfig,
  HostMessage,
  PaneConfig,
  PaneLayout,
  TerminalBackendType,
  ThreadHistoryDashboardDto,
  TmuxDashboardActionMessage,
  TmuxDashboardHostMessage,
  TmuxDashboardSessionDto,
  NativeShellDto,
  TmuxPaneSyncMessage,
  WebviewMessage,
} from "./types";
import {
  DEFAULT_AI_TOOLS,
  TMUX_RAW_ALLOWED_SUBCOMMANDS,
  detectAiToolName,
  getToolDetectionPatterns,
  getToolLaunchCommand,
  resolveAiToolConfigs,
} from "./types";

describe("Types", () => {
  describe("WebviewMessage", () => {
    it("should accept all variants with paneId", () => {
      const messages: WebviewMessage[] = [
        { type: "terminalInput", data: "test input", paneId: "pane-1" },
        {
          type: "terminalResize",
          cols: 80,
          rows: 24,
          paneId: "pane-1",
        },
        { type: "listTerminals", paneId: "pane-1" },
        {
          type: "openFile",
          path: "/test/file.ts",
          line: 10,
          paneId: "pane-1",
        },
        {
          type: "openUrl",
          url: "https://example.com",
          paneId: "pane-1",
        },
        { type: "ready", cols: 80, rows: 24, paneId: "pane-1" },
        {
          type: "filesDropped",
          files: ["/file1.ts", "/file2.ts"],
          shiftKey: true,
          paneId: "pane-1",
        },
        {
          type: "setClipboard",
          text: "clipboard text",
          paneId: "pane-1",
        },
        { type: "triggerPaste", paneId: "pane-1" },
        { type: "imagePasted", data: "data:image/png;base64,AA==", paneId: "pane-1" },
        { type: "switchSession", sessionId: "workspace-a", paneId: "pane-1" },
        { type: "killSession", sessionId: "workspace-a", paneId: "pane-1" },
        { type: "createTmuxSession", paneId: "pane-1" },
        { type: "zoomTmuxPane", paneId: "pane-1" },

        { type: "toggleEditorAttachment", paneId: "pane-1" },
        {
          type: "sendTmuxPromptChoice",
          choice: "tmux",
          paneId: "pane-1",
        },
        {
          type: "selectTerminalBackend",
          backend: "zellij",
          paneId: "pane-1",
        },
        {
          type: "paneSwitchBackend",
          paneId: "pane-1",
          backend: "tmux",
        },
        { type: "cycleTerminalBackend", paneId: "pane-1" },
        {
          type: "executeTmuxCommand",
          commandId: "ulw.tmuxCreateWindow",
          paneId: "pane-1",
        },
        {
          type: "executeTmuxRawCommand",
          subcommand: "rename-session",
          args: ["workspace-renamed"],
          paneId: "pane-1",
        },
        { type: "requestRestart", paneId: "pane-1" },
      ];

      expect(messages).toHaveLength(22);
      expect(messages[0]).toEqual(
        expect.objectContaining({ paneId: "pane-1" }),
      );
      expect(messages[21]?.type).toBe("requestRestart");
    });

    it("should accept all variants without paneId for backward compatibility", () => {
      const messages: WebviewMessage[] = [
        { type: "terminalInput", data: "test input" },
        { type: "terminalResize", cols: 80, rows: 24 },
        { type: "listTerminals" },
        { type: "openFile", path: "/test/file.ts", line: 10 },
        { type: "openUrl", url: "https://example.com" },
        { type: "ready", cols: 80, rows: 24 },
        {
          type: "filesDropped",
          files: ["/file1.ts", "/file2.ts"],
          shiftKey: true,
        },
        { type: "setClipboard", text: "clipboard text" },
        { type: "triggerPaste" },
        { type: "imagePasted", data: "data:image/png;base64,AA==" },
        { type: "switchSession", sessionId: "workspace-a" },
        { type: "killSession", sessionId: "workspace-a" },
        { type: "createTmuxSession" },
        { type: "zoomTmuxPane" },

        { type: "toggleEditorAttachment" },
        { type: "sendTmuxPromptChoice", choice: "tmux" },
        { type: "selectTerminalBackend", backend: "zellij" },
        { type: "cycleTerminalBackend" },
        {
          type: "executeTmuxCommand",
          commandId: "ulw.tmuxCreateWindow",
        },
        {
          type: "executeTmuxRawCommand",
          subcommand: "rename-session",
          args: ["workspace-renamed"],
        },
        { type: "requestRestart" },
      ];

      expect(messages).toHaveLength(21);
      expect(messages[0]?.paneId).toBeUndefined();
      expect(messages[20]?.type).toBe("requestRestart");
    });

    it("should accept terminalInput message", () => {
      const message: WebviewMessage = {
        type: "terminalInput",
        data: "test input",
      };

      expect(message.type).toBe("terminalInput");
      expect(message.data).toBe("test input");
    });

    it("should accept terminalResize message", () => {
      const message: WebviewMessage = {
        type: "terminalResize",
        cols: 80,
        rows: 24,
      };

      expect(message.type).toBe("terminalResize");
      expect(message.cols).toBe(80);
      expect(message.rows).toBe(24);
    });

    it("should accept openFile message with line", () => {
      const message: WebviewMessage = {
        type: "openFile",
        path: "/test/file.ts",
        line: 10,
      };

      expect(message.type).toBe("openFile");
      expect(message.path).toBe("/test/file.ts");
      expect(message.line).toBe(10);
    });

    it("should accept openFile message with line and column", () => {
      const message: WebviewMessage = {
        type: "openFile",
        path: "/test/file.ts",
        line: 10,
        column: 5,
      };

      expect(message.type).toBe("openFile");
      expect(message.path).toBe("/test/file.ts");
      expect(message.line).toBe(10);
      expect(message.column).toBe(5);
    });

    it("accepts openFile message with path line column and endLine", () => {
      const message: WebviewMessage = {
        type: "openFile",
        path: "/test/file.ts",
        line: 10,
        column: 5,
        endLine: 12,
      };

      expect(message.type).toBe("openFile");
      expect(message.path).toBe("/test/file.ts");
      expect(message.line).toBe(10);
      expect(message.column).toBe(5);
      expect(message.endLine).toBe(12);
    });

    it("should accept openUrl message", () => {
      const message: WebviewMessage = {
        type: "openUrl",
        url: "https://example.com",
      };

      expect(message.type).toBe("openUrl");
      expect(message.url).toBe("https://example.com");
    });

    it("should accept ready message", () => {
      const message: WebviewMessage = {
        type: "ready",
        cols: 80,
        rows: 24,
      };

      expect(message.type).toBe("ready");
      expect(message.cols).toBe(80);
      expect(message.rows).toBe(24);
    });

    it("should accept filesDropped message", () => {
      const message: WebviewMessage = {
        type: "filesDropped",
        files: ["/file1.ts", "/file2.ts"],
        shiftKey: true,
      };

      expect(message.type).toBe("filesDropped");
      expect(message.files).toEqual(["/file1.ts", "/file2.ts"]);
      expect(message.shiftKey).toBe(true);
    });

    it("should accept filesDropped blob fallback message", () => {
      const message: WebviewMessage = {
        type: "filesDropped",
        files: [],
        shiftKey: false,
        blobFiles: [
          {
            name: "note.txt",
            data: "data:text/plain;base64,SGVsbG8=",
          },
        ],
      };

      expect(message.type).toBe("filesDropped");
      expect(message.files).toEqual([]);
      expect(message.blobFiles).toEqual([
        {
          name: "note.txt",
          data: "data:text/plain;base64,SGVsbG8=",
        },
      ]);
    });

    it("should accept tmux session control messages", () => {
      const switchMessage: WebviewMessage = {
        type: "switchSession",
        sessionId: "workspace-a",
      };
      const killMessage: WebviewMessage = {
        type: "killSession",
        sessionId: "workspace-a",
      };
      const createMessage: WebviewMessage = {
        type: "createTmuxSession",
      };

      expect(switchMessage.type).toBe("switchSession");
      expect(switchMessage.sessionId).toBe("workspace-a");
      expect(killMessage.type).toBe("killSession");
      expect(killMessage.sessionId).toBe("workspace-a");
      expect(createMessage.type).toBe("createTmuxSession");
    });

    it("should accept terminal backend selection messages", () => {
      const backend: TerminalBackendType = "zellij";
      const selectMessage: WebviewMessage = {
        type: "selectTerminalBackend",
        backend,
      };
      const switchMessage: WebviewMessage = {
        type: "paneSwitchBackend",
        paneId: "pane-2",
        backend: "tmux",
      };
      const cycleMessage: WebviewMessage = { type: "cycleTerminalBackend" };

      expect(selectMessage.backend).toBe("zellij");
      if (switchMessage.type === "paneSwitchBackend") {
        expect(switchMessage.paneId).toBe("pane-2");
        expect(switchMessage.backend).toBe("tmux");
      }
      expect(cycleMessage.type).toBe("cycleTerminalBackend");
    });

    it("should accept executeTmuxCommand messages for supported toolbar commands", () => {
      const message: WebviewMessage = {
        type: "executeTmuxCommand",
        commandId: "ulw.tmuxCreateWindow",
      };

      expect(message.type).toBe("executeTmuxCommand");
      expect(message.commandId).toBe("ulw.tmuxCreateWindow");
    });

    it("should accept executeTmuxRawCommand messages for supported native tmux commands", () => {
      const message: WebviewMessage = {
        type: "executeTmuxRawCommand",
        subcommand: "rename-session",
        args: ["workspace-renamed"],
      };

      expect(message.type).toBe("executeTmuxRawCommand");
      expect(message.subcommand).toBe("rename-session");
      expect(message.args).toEqual(["workspace-renamed"]);
      expect(TMUX_RAW_ALLOWED_SUBCOMMANDS).toContain("choose-tree");
    });

    it("should accept tmux command toolbar host messages", () => {
      const message: HostMessage = {
        type: "toggleTmuxCommandToolbar",
      };

      expect(message.type).toBe("toggleTmuxCommandToolbar");
    });
  });

  describe("Tmux dashboard messages", () => {
    it("should accept tmux dashboard action messages", () => {
      const createMessage: TmuxDashboardActionMessage = {
        action: "create",
      };
      const switchNativeMessage: TmuxDashboardActionMessage = {
        action: "switchNativeShell",
      };
      const activateMessage: TmuxDashboardActionMessage = {
        action: "activate",
        sessionId: "workspace-a-2",
      };

      expect(createMessage.action).toBe("create");
      expect(switchNativeMessage.action).toBe("switchNativeShell");
      expect(activateMessage.action).toBe("activate");
      expect(activateMessage.sessionId).toBe("workspace-a-2");

      const toggleHistoryMessage: TmuxDashboardActionMessage = {
        action: "toggleThreadHistory",
      };
      const archiveMessage: TmuxDashboardActionMessage = {
        action: "archiveThread",
        threadId: "thread-a",
      };
      const restoreMessage: TmuxDashboardActionMessage = {
        action: "restoreThread",
        threadId: "thread-a",
      };
      const deleteMessage: TmuxDashboardActionMessage = {
        action: "deleteThread",
        threadId: "thread-a",
      };
      expect(toggleHistoryMessage.action).toBe("toggleThreadHistory");
      expect(archiveMessage.threadId).toBe("thread-a");
      expect(restoreMessage.threadId).toBe("thread-a");
      expect(deleteMessage.threadId).toBe("thread-a");
    });

    it("carries workspace URI on dashboard project contracts", () => {
      const workspaceUri = "file:///workspaces/repo-a";
      const session: TmuxDashboardSessionDto = {
        id: "repo-a",
        name: "Repo A",
        workspace: "repo-a",
        workspaceUri,
        isActive: true,
      };
      const nativeShell: NativeShellDto = {
        id: "shell-a",
        label: "Shell A",
        state: "connected",
        isActive: false,
        workspaceUri,
      };
      const activateMessage: TmuxDashboardActionMessage = {
        action: "activate",
        sessionId: session.id,
        workspaceUri,
      };

      expect(session.workspaceUri).toBe(workspaceUri);
      expect(nativeShell.workspaceUri).toBe(workspaceUri);
      expect(activateMessage.workspaceUri).toBe(workspaceUri);
    });

    it("should accept tmux dashboard host messages", () => {
      const threadHistory: ThreadHistoryDashboardDto = {
        active: [
          {
            id: "thread-a",
            kind: "agent",
            title: "Implement project history",
            sessionId: "repo-a",
            workspaceName: "repo-a",
            workspaceUri: "file:///workspaces/repo-a",
            createdAt: "2026-06-02T08:00:00.000Z",
            updatedAt: "2026-06-02T09:00:00.000Z",
            status: "running",
          },
        ],
        projects: [
          {
            workspaceName: "repo-a",
            workspaceUri: "file:///workspaces/repo-a",
            entries: [],
          },
        ],
        buckets: [{ bucket: "today", entries: [] }],
      };
      const message: TmuxDashboardHostMessage = {
        type: "updateTmuxSessions",
        workspace: "repo-a",
        workspaceUri: "file:///workspaces/repo-a",
        threadHistory,
        showingThreadHistory: true,
        sessions: [
          {
            id: "repo-a-2",
            name: "repo-a-2",
            workspace: "repo-a",
            isActive: true,
          },
        ],
      };

      expect(message.type).toBe("updateTmuxSessions");
      expect(message.workspace).toBe("repo-a");
      expect(message.workspaceUri).toBe("file:///workspaces/repo-a");
      expect(message.sessions[0]?.isActive).toBe(true);
      expect(message.threadHistory?.active[0]?.title).toBe(
        "Implement project history",
      );
      expect(message.showingThreadHistory).toBe(true);
    });

    it("uses default AI tools baseline", () => {
      expect(DEFAULT_AI_TOOLS[0]?.name).toBe("opencode");
      expect(DEFAULT_AI_TOOLS[0]?.args).toEqual(["-c"]);
      expect(DEFAULT_AI_TOOLS[1]?.name).toBe("claude");
      expect(DEFAULT_AI_TOOLS[1]?.aliases).toContain("claude");
    });
  });

  describe("HostMessage", () => {
    it("should accept data-related host messages with paneId", () => {
      const messages: HostMessage[] = [
        {
          type: "terminalOutput",
          data: "output data",
          paneId: "pane-1",
        },
        { type: "terminalExited", paneId: "pane-1" },
        { type: "clearTerminal", paneId: "pane-1" },
        { type: "focusTerminal", paneId: "pane-1" },
        { type: "webviewVisible", paneId: "pane-1" },
        { type: "paneBackendChanged", paneId: "pane-1", backend: "zellij" },
      ];

      expect(messages[0]).toEqual(
        expect.objectContaining({ paneId: "pane-1" }),
      );
      expect(messages[5]?.type).toBe("paneBackendChanged");
    });

    it("should accept terminalOutput message", () => {
      const message: HostMessage = {
        type: "terminalOutput",
        data: "output data",
      };

      expect(message.type).toBe("terminalOutput");
      expect(message.data).toBe("output data");
    });

    it("should accept terminalExited message", () => {
      const message: HostMessage = {
        type: "terminalExited",
      };

      expect(message.type).toBe("terminalExited");
    });

    it("should accept focusTerminal message", () => {
      const message: HostMessage = {
        type: "focusTerminal",
      };

      expect(message.type).toBe("focusTerminal");
    });

    it("should define pane layout and pane config structures", () => {
      const layout: PaneLayout = {
        tabId: "tab-1",
        paneId: "pane-1",
        splitDirection: "horizontal",
        size: 50,
        children: [
          {
            tabId: "tab-1",
            paneId: "pane-2",
          },
        ],
      };

      const config: PaneConfig = {
        paneId: "pane-1",
        command: "npm run dev",
        cwd: "/workspace",
        backend: "tmux",
        backendConfig: {
          tmux: { sessionId: "workspace-a", paneId: "%1" },
        },
      };

      const legacyConfig: PaneConfig = {
        paneId: "pane-legacy",
        command: "npm test",
        cwd: "/workspace",
      };

      expect(layout.children?.[0]?.paneId).toBe("pane-2");
      expect(config.backend).toBe("tmux");
      expect(config.backendConfig?.tmux?.paneId).toBe("%1");
      expect(legacyConfig.backend).toBeUndefined();
      expect(legacyConfig.backendConfig).toBeUndefined();
    });

    it("should accept backend pane config shapes and tmux pane sync messages", () => {
      const backendConfig: BackendPaneConfig = {
        tmux: { sessionId: "session-1", paneId: "%2" },
        zellij: { sessionId: "zellij-session-1" },
        native: {},
      };
      const syncMessages: TmuxPaneSyncMessage[] = [
        { paneId: "pane-1", tmuxPaneId: "%1", action: "created" },
        { paneId: "pane-1", tmuxPaneId: "%1", action: "resized" },
        { paneId: "pane-1", tmuxPaneId: "%1", action: "removed" },
      ];

      expect(backendConfig.tmux?.sessionId).toBe("session-1");
      expect(backendConfig.zellij?.sessionId).toBe("zellij-session-1");
      expect(backendConfig.native).toEqual({});
      expect(syncMessages.map((message) => message.action)).toEqual([
        "created",
        "resized",
        "removed",
      ]);
    });

    it("should narrow pane backend host messages by discriminant", () => {
      const message: HostMessage = {
        type: "paneBackendChanged",
        paneId: "pane-3",
        backend: "native",
      };

      if (message.type === "paneBackendChanged") {
        const backend: TerminalBackendType = message.backend;
        expect(message.paneId).toBe("pane-3");
        expect(backend).toBe("native");
      }
    });
  });

  describe("AI tool helpers", () => {
    it("normalizes configured tools with default path, args, aliases, and operator", () => {
      expect(
        resolveAiToolConfigs([
          null,
          { name: "missing-label" },
          {
            name: "custom",
            label: "Custom Tool",
            path: 42,
            args: ["run", 5],
            aliases: "custom-alias",
            operator: false,
          },
        ]),
      ).toEqual([
        {
          name: "custom",
          label: "Custom Tool",
          path: "",
          args: ["run", "5"],
          aliases: undefined,
          operator: undefined,
        },
      ]);

      expect(
        resolveAiToolConfigs([
          {
            name: "no-args-array",
            label: "No Args Array",
            args: "--bad",
          },
        ])[0].args,
      ).toEqual([]);
    });

    it("builds launch commands and detection patterns from optional config fields", () => {
      const tool = {
        name: "assistant",
        label: "Assistant CLI",
        path: "C:\\Tools\\assistant.exe",
        args: ["--print", "hello"],
        aliases: ["helper"],
        operator: "codex",
      };

      expect(getToolLaunchCommand(tool)).toBe(
        "C:\\Tools\\assistant.exe --print hello",
      );
      expect(getToolDetectionPatterns(tool)).toEqual(
        expect.arrayContaining([
          "assistant",
          "assistant.exe",
          "codex",
          "codex.exe",
          "helper",
          "helper.exe",
          "Assistant CLI",
        ]),
      );
    });

    it("adds non-matching basenames and skips empty detection text", () => {
      const tool = {
        name: "assistant",
        label: "Assistant CLI",
        path: "/opt/bin/custom-assistant",
        args: [],
        aliases: undefined,
        operator: undefined,
      };

      expect(getToolDetectionPatterns(tool)).toContain("custom-assistant");
      expect(detectAiToolName(undefined, [tool])).toBeUndefined();
      expect(detectAiToolName("run CUSTOM-ASSISTANT now", [tool])).toBe(
        "assistant",
      );
    });
  });
});
