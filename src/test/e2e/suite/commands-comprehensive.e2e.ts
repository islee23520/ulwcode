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
    "opencodeTui.start",
    "opencodeTui.focus",
    "opencodeTui.paste",
    "opencodeTui.openTerminalInEditor",
    "opencodeTui.restoreTerminalToSidebar",
  ],
  "file-reference": [
    "opencodeTui.sendToTerminal",
    "opencodeTui.sendAtMention",
    "opencodeTui.sendAllOpenFiles",
    "opencodeTui.sendFileToTerminal",
  ],
  "tmux-session": [
    "opencode.openInNewWindow",
    "opencodeTui.openSessionInNewWindow",
    "opencode.spawnForWorkspace",
    "opencodeTui.selectInstance",
    "opencodeTui.switchTmuxSession",
    "opencodeTui.createTmuxSession",
    "opencodeTui.openNewSessionTerminalInEditor",
    "opencodeTui.browseTmuxSessions",
    "opencodeTui.switchNativeShell",
    "opencodeTui.killNativeShell",
    "opencodeTui.tmuxKillSession",
    "opencodeTui.killTmuxSession",
  ],
  "tmux-pane": [
    "opencodeTui.tmuxSwitchPane",
    "opencodeTui.tmuxSplitPaneH",
    "opencodeTui.tmuxSplitPaneV",
    "opencodeTui.tmuxSplitPaneWithCommand",
    "opencodeTui.tmuxSendTextToPane",
    "opencodeTui.tmuxResizePane",
    "opencodeTui.tmuxSwapPane",
    "opencodeTui.tmuxKillPane",
  ],
  "tmux-window": [
    "opencodeTui.tmuxNextWindow",
    "opencodeTui.tmuxPrevWindow",
    "opencodeTui.tmuxCreateWindow",
    "opencodeTui.tmuxKillWindow",
    "opencodeTui.tmuxSelectWindow",
  ],
  dashboard: [
    "opencodeTui.openTerminalManager",
    "opencodeTui.toggleDashboard",
    "opencodeTui.toggleTmuxCommandToolbar",
    "opencodeTui.openDashboardInEditor",
    "opencodeTui.tmuxRefresh",
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
