import * as vscode from "vscode";
import type { TerminalProvider } from "../../providers/TerminalProvider";
import type { ContextSharingService } from "../../services/ContextSharingService";
import type { OutputChannelService } from "../../services/OutputChannelService";
import type { TerminalManager } from "../../terminals/TerminalManager";

let fileSendAccumulator: vscode.Uri[] = [];
let fileSendTimeout: NodeJS.Timeout | undefined;

export interface TerminalCommandDependencies {
  provider: TerminalProvider | undefined;
  terminalManager: TerminalManager | undefined;
  contextSharingService: ContextSharingService | undefined;
  outputChannel: OutputChannelService | undefined;
  getActiveTerminalId: () => string;
  sendTerminalCwd: () => void;
  sendPrompt: (prompt: string) => Promise<void>;
}

type TerminalDefaultLocation = "editor" | "sidebar";

function getTerminalDefaultLocation(): TerminalDefaultLocation {
  const config = vscode.workspace.getConfiguration("ulw");
  return config.get<TerminalDefaultLocation>(
    "terminal.defaultLocation",
    "editor",
  );
}

function focusTerminalIfConfigured(
  provider: TerminalProvider | undefined,
): void {
  const config = vscode.workspace.getConfiguration("ulw");
  if (config.get<boolean>("autoFocusOnSend", true)) {
    vscode.commands.executeCommand("ulw.focus");
    setTimeout(() => {
      provider?.focus();
    }, 100);
  }
}

function startConfiguredTerminal(provider: TerminalProvider | undefined): void {
  if (provider) {
    void provider.startAtConfiguredLocation();
    return;
  }

  if (getTerminalDefaultLocation() === "sidebar") {
    void vscode.commands.executeCommand("workbench.view.focus", "ulw");
  }
}

function focusConfiguredTerminal(
  provider: TerminalProvider | undefined,
): Thenable<unknown> | Promise<void> {
  if (provider) {
    return provider.focusAtConfiguredLocation();
  }

  if (getTerminalDefaultLocation() === "sidebar") {
    return vscode.commands.executeCommand(
      "workbench.view.focus",
      "ulw",
    );
  }

  return Promise.resolve();
}

export function registerTerminalCommands(
  deps: TerminalCommandDependencies,
): vscode.Disposable[] {
  const startCommand = vscode.commands.registerCommand(
    "ulw.start",
    () => {
      startConfiguredTerminal(deps.provider);
    },
  );

  const sendToTerminalCommand = vscode.commands.registerCommand(
    "ulw.sendToTerminal",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        return;
      }

      const selectedText = editor.document.getText(editor.selection);
      const terminalId = deps.getActiveTerminalId();
      deps.outputChannel?.info(
        `[DIAG:sendToTerminal] terminalId="${terminalId}" textLength=${selectedText.length}`,
      );
      void deps.sendPrompt(selectedText + "\n");
      focusTerminalIfConfigured(deps.provider);
    },
  );

  const sendAtMentionCommand = vscode.commands.registerCommand(
    "ulw.sendAtMention",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        deps.outputChannel?.warn("[DIAG:sendAtMention] skipped — editor missing");
        deps.sendTerminalCwd();
        return;
      }

      const fileRef = deps.provider?.formatEditorReference(editor);
      if (!fileRef) {
        deps.outputChannel?.warn(
          `[DIAG:sendAtMention] skipped — provider=${!!deps.provider}`,
        );
        deps.sendTerminalCwd();
        return;
      }

      const terminalId = deps.getActiveTerminalId();
      deps.outputChannel?.info(
        `[DIAG:sendAtMention] terminalId="${terminalId}" fileRef="${fileRef}"`,
      );
      void deps.sendPrompt(fileRef + " ");
    },
  );

  const sendAllOpenFilesCommand = vscode.commands.registerCommand(
    "ulw.sendAllOpenFiles",
    () => {
      const fileRefs: string[] = [];

      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            const uri = tab.input.uri;
            if (!uri.scheme.startsWith("untitled") && deps.provider) {
              fileRefs.push(deps.provider.formatUriReference(uri));
            }
          }
        }
      }

      const openFiles = fileRefs.join(" ");
      if (openFiles) {
        const terminalId = deps.getActiveTerminalId();
        deps.outputChannel?.info(
          `[DIAG:sendAllOpenFiles] terminalId="${terminalId}" fileCount=${fileRefs.length} refs="${openFiles}"`,
        );
        void deps.sendPrompt(openFiles + " ");
        focusTerminalIfConfigured(deps.provider);
      }
    },
  );

  const sendFileToTerminalCommand = vscode.commands.registerCommand(
    "ulw.sendFileToTerminal",
    (...args: unknown[]) => {
      if (!deps.contextSharingService) {
        return;
      }

      let uris: vscode.Uri[];
      if (args.length > 0 && Array.isArray(args[args.length - 1])) {
        uris = args[args.length - 1] as vscode.Uri[];
      } else if (args.length > 0 && args[0] instanceof vscode.Uri) {
        uris = [args[0]];
      } else {
        return;
      }

      fileSendAccumulator.push(...uris);

      if (fileSendTimeout) {
        clearTimeout(fileSendTimeout);
      }

      fileSendTimeout = setTimeout(() => {
        if (fileSendAccumulator.length === 0) {
          return;
        }

        const provider = deps.provider;
        if (!provider) {
          fileSendAccumulator = [];
          return;
        }

        const uniqueUris = [
          ...new Map(
            fileSendAccumulator.map((u: vscode.Uri) => [u.fsPath, u]),
          ).values(),
        ];

        const fileRefs = uniqueUris.map((u: vscode.Uri) =>
          provider.formatUriReference(u),
        );
        const allRefs = fileRefs.join(" ");

        const terminalId = deps.getActiveTerminalId();
        deps.outputChannel?.info(
          `[DIAG:sendFileToTerminal] terminalId="${terminalId}" fileCount=${uniqueUris.length} refs="${allRefs}"`,
        );
        void deps.sendPrompt(allRefs + " ");

        focusTerminalIfConfigured(deps.provider);
        fileSendAccumulator = [];
      }, 100);
    },
  );

  const pasteCommand = vscode.commands.registerCommand(
    "ulw.paste",
    async () => {
      try {
        if (deps.provider) {
          deps.provider.requestPaste();
        }
      } catch (error) {
        deps.outputChannel?.error(
          `[TerminalProvider] Failed to paste: ${error instanceof Error ? error.message : String(error)}`,
        );
        vscode.window.showErrorMessage("Failed to paste from clipboard");
      }
    },
  );

  const focusCommand = vscode.commands.registerCommand(
    "ulw.focus",
    () => {
      return focusConfiguredTerminal(deps.provider);
    },
  );

  const openInEditorCommand = vscode.commands.registerCommand(
    "ulw.openTerminalInEditor",
    () => {
      void deps.provider?.openInEditorTab();
    },
  );

  const restoreToSidebarCommand = vscode.commands.registerCommand(
    "ulw.restoreTerminalToSidebar",
    () => {
      void deps.provider?.toggleEditorAttachment();
    },
  );

  return [
    startCommand,
    sendToTerminalCommand,
    sendAtMentionCommand,
    sendAllOpenFilesCommand,
    sendFileToTerminalCommand,
    pasteCommand,
    focusCommand,
    openInEditorCommand,
    restoreToSidebarCommand,
  ];
}
