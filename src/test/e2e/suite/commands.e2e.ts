import * as assert from "assert";
import * as vscode from "vscode";

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension(
    "islee23520.ulwcode",
  );

  assert.ok(extension, "Extension should be available in the test host");
  await extension.activate();
  return extension;
}

suite("Command registration", () => {
  test("registers core extension commands", async () => {
    await activateExtension();

    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes("ulw.start"));
    assert.ok(commands.includes("ulw.focus"));
    assert.ok(commands.includes("ulw.openTerminalInEditor"));
    assert.ok(commands.includes("ulw.openNewSessionTerminalInEditor"));
    assert.ok(commands.includes("ulw.toggleDashboard"));
  });

  test("registers focus command without relying on internal workbench commands", async () => {
    await activateExtension();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("ulw.focus"),
      "ulw.focus should be registered",
    );
  });

  test("uses opencode auto-start defaults", async () => {
    const extension = await activateExtension();

    const properties = extension.packageJSON.contributes.configuration
      .properties as Record<string, { default: unknown }>;

    assert.strictEqual(properties["ulw.autoStartOnOpen"].default, true);
    assert.strictEqual(
      properties["ulw.defaultAiTool"].default,
      "opencode",
    );
  });
});
