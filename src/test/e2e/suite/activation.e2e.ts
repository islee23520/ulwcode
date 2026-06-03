import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension activation", () => {
  test("activates the extension", async () => {
    const extension = vscode.extensions.getExtension(
      "islee23520.opencode-sidebar-tui",
    );

    assert.ok(extension, "Extension should be available in the test host");

    await extension?.activate();

    assert.strictEqual(extension?.isActive, true);
  });
});
