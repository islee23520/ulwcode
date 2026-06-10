import * as vscode from "vscode";
import type { TerminalProvider } from "../../providers/TerminalProvider";

export interface TmuxToolbarCommandDependencies {
  provider: Pick<TerminalProvider, "toggleTmuxCommandToolbar"> | undefined;
}

export function registerTmuxToolbarCommands(
  deps: TmuxToolbarCommandDependencies,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("ulw.toggleTmuxCommandToolbar", () => {
      deps.provider?.toggleTmuxCommandToolbar();
    }),
  ];
}
