import * as assert from "assert";
import * as vscode from "vscode";

interface ViewContainerContribution {
  id?: string;
  title?: string;
  icon?: string;
}

interface ViewContribution {
  id?: string;
  name?: string;
  type?: string;
}

interface MenuContribution {
  command?: string;
  group?: string;
  when?: string;
}

interface KeybindingContribution {
  command?: string;
  key?: string;
  mac?: string;
  when?: string;
}

interface ExtensionPackageJSON {
  contributes?: {
    viewsContainers?: Record<string, ViewContainerContribution[]>;
    views?: Record<string, ViewContribution[]>;
    menus?: Record<string, MenuContribution[]>;
    keybindings?: KeybindingContribution[];
  };
}

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension(
    "islee23520.opencode-sidebar-tui",
  );

  assert.ok(extension, "Extension should be available in the test host");
  await extension.activate();
  return extension;
}

async function getPackageJSON(): Promise<ExtensionPackageJSON> {
  const extension = await activateExtension();
  return extension.packageJSON as ExtensionPackageJSON;
}

suite("Package contribution metadata", () => {
  test("contributes the Open Sidebar Terminal view container", async () => {
    const packageJSON = await getPackageJSON();
    const secondarySidebar =
      packageJSON.contributes?.viewsContainers?.secondarySidebar ?? [];
    const container = secondarySidebar.find(
      ({ id }) => id === "opencodeTuiContainer",
    );

    assert.ok(container, "opencodeTuiContainer should be contributed");
    assert.strictEqual(container.title, "Open Sidebar Terminal");
    assert.strictEqual(container.icon, "resources/opencode-activity-bar.svg");
  });

  test("contributes terminal view metadata", async () => {
    const packageJSON = await getPackageJSON();
    const views = packageJSON.contributes?.views?.opencodeTuiContainer ?? [];
    const terminalView = views.find(({ id }) => id === "opencodeTui");

    assert.ok(terminalView, "opencodeTui webview should be contributed");
    assert.strictEqual(terminalView.type, "webview");
  });

  test("contributes editor and explorer context menus", async () => {
    const packageJSON = await getPackageJSON();
    const menus = packageJSON.contributes?.menus;
    const editorContext = menus?.["editor/context"] ?? [];
    const explorerContext = menus?.["explorer/context"] ?? [];

    assert.ok(
      editorContext.some(
        ({ command, group }) =>
          command === "opencodeTui.sendAtMention" && group === "navigation",
      ),
      "editor/context should include sendAtMention",
    );
    assert.ok(
      explorerContext.some(
        ({ command, group, when }) =>
          command === "opencodeTui.sendFileToTerminal" &&
          group === "2_workspace" &&
          when === "!explorerResourceIsFolder",
      ),
      "explorer/context should include file send command",
    );
    assert.ok(
      explorerContext.some(
        ({ command, group, when }) =>
          command === "opencodeTui.sendFileToTerminal" &&
          group === "2_workspace" &&
          when === "explorerResourceIsFolder",
      ),
      "explorer/context should include folder send command",
    );
  });

  test("contributes required keyboard shortcuts", async () => {
    const packageJSON = await getPackageJSON();
    const keybindings = packageJSON.contributes?.keybindings ?? [];
    const expectedKeybindings = [
      {
        command: "opencodeTui.sendAtMention",
        key: "ctrl+alt+l",
        mac: "cmd+alt+l",
      },
      {
        command: "opencodeTui.sendAllOpenFiles",
        key: "ctrl+alt+a",
        mac: "cmd+alt+a",
      },
      {
        command: "opencodeTui.browseTmuxSessions",
        key: "ctrl+alt+t",
        mac: "cmd+alt+t",
      },
    ];

    for (const expected of expectedKeybindings) {
      assert.ok(
        keybindings.some(
          ({ command, key, mac }) =>
            command === expected.command &&
            key === expected.key &&
            mac === expected.mac,
        ),
        `${expected.command} should have ${expected.mac} keybinding`,
      );
    }
  });
});
