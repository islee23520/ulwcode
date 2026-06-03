import * as assert from "assert";
import * as vscode from "vscode";

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension(
    "islee23520.opencode-sidebar-tui",
  );

  assert.ok(extension, "Extension should be available in the test host");
  await extension.activate();
  return extension;
}

const commandCategories = {
  core: [
    "ulw.start",
    "ulw.focus",
    "ulw.paste",
    "ulw.openTerminalInEditor",
    "ulw.restoreTerminalToSidebar",
  ],
  "file-reference": [
    "ulw.sendToTerminal",
    "ulw.sendAtMention",
    "ulw.sendAllOpenFiles",
    "ulw.sendFileToTerminal",
  ],
  "tmux-session": [
    "ulw.openInNewWindow",
    "ulw.openSessionInNewWindow",
    "ulw.spawnForWorkspace",
    "ulw.selectInstance",
    "ulw.switchTmuxSession",
    "ulw.createTmuxSession",
    "ulw.openNewSessionTerminalInEditor",
    "ulw.browseTmuxSessions",
    "ulw.switchNativeShell",
    "ulw.killNativeShell",
    "ulw.tmuxKillSession",
    "ulw.killTmuxSession",
  ],
  "tmux-pane": [
    "ulw.tmuxSwitchPane",
    "ulw.tmuxSplitPaneH",
    "ulw.tmuxSplitPaneV",
    "ulw.tmuxSplitPaneWithCommand",
    "ulw.tmuxSendTextToPane",
    "ulw.tmuxResizePane",
    "ulw.tmuxSwapPane",
    "ulw.tmuxKillPane",
  ],
  "tmux-window": [
    "ulw.tmuxNextWindow",
    "ulw.tmuxPrevWindow",
    "ulw.tmuxCreateWindow",
    "ulw.tmuxKillWindow",
    "ulw.tmuxSelectWindow",
  ],
  dashboard: [
    "ulw.openTerminalManager",
    "ulw.toggleDashboard",
    "ulw.toggleTmuxCommandToolbar",
    "ulw.openDashboardInEditor",
    "ulw.tmuxRefresh",
  ],
} as const satisfies Record<string, readonly string[]>;

function allExpectedCommands(): string[] {
  return Object.values(commandCategories).flatMap((commands) => [...commands]);
}

suite("Comprehensive command registration", () => {
  for (const [category, expectedCommands] of Object.entries(commandCategories)) {
    test(`registers ${category} commands`, async () => {
      await activateExtension();
      const registeredCommands = await vscode.commands.getCommands(true);

      for (const command of expectedCommands) {
        assert.ok(
          registeredCommands.includes(command),
          `${command} should be registered in ${category}`,
        );
      }
    });
  }

  test("registers every package command exactly once in the comprehensive list", async () => {
    const extension = await activateExtension();
    const packageJSON = extension.packageJSON as {
      contributes?: { commands?: Array<{ command?: string }> };
    };
    const contributedCommands =
      packageJSON.contributes?.commands?.map(({ command }) => command) ?? [];
    const expectedCommands = allExpectedCommands();

    assert.strictEqual(expectedCommands.length, 39);
    assert.deepStrictEqual(
      [...new Set(expectedCommands)].sort(),
      [...expectedCommands].sort(),
    );
    assert.deepStrictEqual(contributedCommands.sort(), expectedCommands.sort());
  });
});
