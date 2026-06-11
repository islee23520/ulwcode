import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension(
    "islee23520.opencode-sidebar-tui",
  );

  assert.ok(extension, "Extension should be available in the test host");
  await extension.activate();
  return extension;
}

async function executeCommandWithoutUserInput(commandId: string): Promise<void> {
  const closeQuickPick =
    commandId === "ulw.browseTmuxSessions"
      ? setTimeout(() => {
          void vscode.commands.executeCommand("workbench.action.closeQuickOpen");
        }, 250)
      : undefined;

  try {
    await vscode.commands.executeCommand(commandId);
  } finally {
    if (closeQuickPick) {
      clearTimeout(closeQuickPick);
    }
  }
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

async function withFileDocument(
  callback: (document: vscode.TextDocument) => Promise<void>,
): Promise<void> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "ulw-command-e2e-"),
  );
  try {
    const filePath = path.join(tempDir, "qa-file.ts");
    await fs.writeFile(filePath, "export const qa = 1;\n", "utf8");
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(filePath),
    );
    await vscode.window.showTextDocument(document);
    await callback(document);
  } finally {
    await closeAllEditors();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function assertFileReferenceCommandDoesNotOpenTerminalEditor(
  commandId: "ulw.sendAtMention" | "ulw.sendAllOpenFiles",
  options: { readonly revealSidebarFirst: boolean },
): Promise<void> {
  await activateExtension();
  await closeAllEditors();
  const config = vscode.workspace.getConfiguration("ulw");
  const previousDefaultLocation = config.get<string>(
    "terminal.defaultLocation",
  );
  const previousAutoFocusOnSend = config.get<boolean>("autoFocusOnSend");

  try {
    await config.update(
      "terminal.defaultLocation",
      "editor",
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "autoFocusOnSend",
      true,
      vscode.ConfigurationTarget.Global,
    );
    if (options.revealSidebarFirst) {
      await vscode.commands.executeCommand("workbench.view.extension.ulwContainer");
    }

    await withFileDocument(async (document) => {
      await vscode.commands.executeCommand(commandId);
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.strictEqual(
        vscode.window.visibleTextEditors.length,
        1,
        `${commandId} should keep the existing editor surface instead of opening a terminal editor`,
      );
      assert.strictEqual(
        vscode.window.visibleTextEditors[0]?.document.uri.toString(),
        document.uri.toString(),
        `${commandId} should leave the original editor visible`,
      );
    });
  } finally {
    await config.update(
      "terminal.defaultLocation",
      previousDefaultLocation,
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "autoFocusOnSend",
      previousAutoFocusOnSend,
      vscode.ConfigurationTarget.Global,
    );
    await closeAllEditors();
  }
}

async function assertTerminalFocusAtMentionDoesNotOpenTerminalEditor(): Promise<void> {
  await activateExtension();
  await closeAllEditors();
  const config = vscode.workspace.getConfiguration("ulw");
  const previousDefaultLocation = config.get<string>(
    "terminal.defaultLocation",
  );
  const previousAutoFocusOnSend = config.get<boolean>("autoFocusOnSend");
  const terminal = vscode.window.createTerminal(
    "ulw-command-e2e-terminal-focus",
  );

  try {
    await config.update(
      "terminal.defaultLocation",
      "editor",
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "autoFocusOnSend",
      true,
      vscode.ConfigurationTarget.Global,
    );
    terminal.show();
    await new Promise((resolve) => setTimeout(resolve, 150));

    await vscode.commands.executeCommand("ulw.sendAtMention");
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.strictEqual(
      vscode.window.visibleTextEditors.length,
      0,
      "ulw.sendAtMention from terminal focus should not open a terminal editor",
    );
  } finally {
    terminal.dispose();
    await config.update(
      "terminal.defaultLocation",
      previousDefaultLocation,
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "autoFocusOnSend",
      previousAutoFocusOnSend,
      vscode.ConfigurationTarget.Global,
    );
    await closeAllEditors();
  }
}

suite("Command behavior", () => {
  const safeCommands = [
    "ulw.start",
    "ulw.toggleTmuxCommandToolbar",
    "ulw.browseTmuxSessions",
    "ulw.switchTmuxSession",
    "ulw.switchNativeShell",
  ];

  for (const commandId of safeCommands) {
    test(`executes ${commandId} without throwing`, async () => {
      await activateExtension();

      await assert.doesNotReject(async () => {
        await executeCommandWithoutUserInput(commandId);
      });
    });
  }

  test("sends at-mention to an existing target without opening a configured terminal editor", async () => {
    await assertFileReferenceCommandDoesNotOpenTerminalEditor(
      "ulw.sendAtMention",
      { revealSidebarFirst: true },
    );
  });

  test("sends at-mention without opening a terminal editor when no target is resolved yet", async () => {
    await assertFileReferenceCommandDoesNotOpenTerminalEditor(
      "ulw.sendAtMention",
      { revealSidebarFirst: false },
    );
  });

  test("sends all open file references to an existing target without opening a configured terminal editor", async () => {
    await assertFileReferenceCommandDoesNotOpenTerminalEditor(
      "ulw.sendAllOpenFiles",
      { revealSidebarFirst: true },
    );
  });

  test("sends all open file references without opening a terminal editor when no target is resolved yet", async () => {
    await assertFileReferenceCommandDoesNotOpenTerminalEditor(
      "ulw.sendAllOpenFiles",
      { revealSidebarFirst: false },
    );
  });

  test("routes terminal-focus at-mention fallback without opening a configured terminal editor", async () => {
    await assertTerminalFocusAtMentionDoesNotOpenTerminalEditor();
  });
});
