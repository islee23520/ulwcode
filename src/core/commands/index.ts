import * as vscode from "vscode";
import type { ContextManager } from "../../services/ContextManager";
import type { ContextSharingService } from "../../services/ContextSharingService";
import type { InstanceController } from "../../services/InstanceController";
import type { InstanceQuickPick } from "../../services/InstanceQuickPick";
import type { TerminalManager } from "../../terminals/TerminalManager";
import {
  registerTerminalCommands,
  type TerminalCommandDependencies,
} from "./terminalCommands";
import {
  registerTmuxSessionCommands,
  type TmuxSessionCommandDependencies,
} from "./tmuxSessionCommands";
import {
  registerTmuxPaneCommands,
  type TmuxPaneCommandDependencies,
} from "./tmuxPaneCommands";
import {
  registerTmuxToolbarCommands,
  type TmuxToolbarCommandDependencies,
} from "./tmuxToolbarCommands";

export type RegisterCommandDependencies = TerminalCommandDependencies &
  TmuxSessionCommandDependencies &
  TmuxPaneCommandDependencies &
  TmuxToolbarCommandDependencies & {
  terminalManager: TerminalManager | undefined;
  contextSharingService: ContextSharingService | undefined;
  contextManager: ContextManager | undefined;
  instanceController: InstanceController | undefined;
  instanceQuickPick: InstanceQuickPick | undefined;
};

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: RegisterCommandDependencies,
): void {
  const disposables: vscode.Disposable[] = [
    ...registerTerminalCommands(deps),
    ...registerTmuxSessionCommands(deps),
    ...registerTmuxPaneCommands(deps),
    ...registerTmuxToolbarCommands(deps),
  ];

  context.subscriptions.push(...disposables);
}

export {
  registerTerminalCommands,
  registerTmuxSessionCommands,
  registerTmuxPaneCommands,
};
