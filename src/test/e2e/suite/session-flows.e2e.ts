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

async function getRegisteredCommands(): Promise<string[]> {
  await activateExtension();
  return vscode.commands.getCommands(true);
}

function assertCommandRegistered(commands: string[], commandId: string): void {
  assert.ok(commands.includes(commandId), `${commandId} should be registered`);
}

suite("Session flows", () => {
  test("registers tmux-related commands", async () => {
    const commands = await getRegisteredCommands();

    assertCommandRegistered(commands, "ulw.switchTmuxSession");
    assertCommandRegistered(commands, "ulw.spawnForWorkspace");
    assertCommandRegistered(commands, "ulw.browseTmuxSessions");
  });

  test("registers zellij-capable session controls", async () => {
    const extension = await activateExtension();
    const commands = await vscode.commands.getCommands(true);
    const packageJSON = extension.packageJSON as {
      contributes?: {
        configuration?: {
          properties?: Record<
            string,
            {
              enum?: string[];
            }
          >;
        };
      };
    };
    const terminalBackend =
      packageJSON.contributes?.configuration?.properties?.[
        "ulw.terminalBackend"
      ];

    assert.ok(
      terminalBackend?.enum?.includes("zellij"),
      "terminalBackend should support zellij",
    );
    assertCommandRegistered(commands, "ulw.browseTmuxSessions");
    assertCommandRegistered(commands, "ulw.switchTmuxSession");
  });

  test("executes switchTmuxSession command without requiring tmux", async () => {
    await activateExtension();

    await assert.doesNotReject(
      async () =>
        vscode.commands.executeCommand("ulw.switchTmuxSession"),
    );
  });

  test("executes switchNativeShell command", async () => {
    const commands = await getRegisteredCommands();
    assertCommandRegistered(commands, "ulw.switchNativeShell");

    await assert.doesNotReject(
      async () =>
        vscode.commands.executeCommand("ulw.switchNativeShell"),
    );
  });
});
