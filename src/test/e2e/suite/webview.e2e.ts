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

suite("Webview registration", () => {
  test("registers the sidebar view contribution", async () => {
    const extension = await activateExtension();
    const packageJSON = extension.packageJSON as {
      contributes?: {
        views?: Record<string, Array<{ id?: string; type?: string }>>;
      };
    };

    const sidebarViews =
      packageJSON.contributes?.views?.ulwContainer ?? [];
    const terminalView = sidebarViews.find((view) => view.id === "ulw");

    assert.ok(terminalView, "ulw sidebar view should be contributed");
    assert.strictEqual(terminalView.type, "webview");
  });

  test("registers the dashboard view command", async () => {
    await activateExtension();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("ulw.toggleDashboard"),
      "Dashboard command should be registered",
    );
  });

  test("view container command is registered", async () => {
    await activateExtension();

    const commands = await vscode.commands.getCommands(true);
    const viewContainerCommand = "workbench.view.extension.ulwContainer";

    assert.ok(
      commands.includes(viewContainerCommand),
      `${viewContainerCommand} should be registered when extension contributes a view container`,
    );
  });
});
