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
  icon?: string;
  when?: string;
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
  name?: string;
  publisher?: string;
  displayName?: string;
  description?: string;
  contributes?: {
    viewsContainers?: Record<string, ViewContainerContribution[]>;
    views?: Record<string, ViewContribution[]>;
    commands?: Array<{ command?: string; title?: string; category?: string }>;
    configuration?: { title?: string };
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
  test("contributes the ULW view container without changing extension identity", async () => {
    const packageJSON = await getPackageJSON();
    const secondarySidebar =
      packageJSON.contributes?.viewsContainers?.secondarySidebar ?? [];
    const container = secondarySidebar.find(
      ({ id }) => id === "ulwContainer",
    );

    assert.ok(container, "ulwContainer should be contributed");
    assert.strictEqual(packageJSON.name, "opencode-sidebar-tui");
    assert.strictEqual(packageJSON.publisher, "islee23520");
    assert.strictEqual(packageJSON.displayName, "ulwcode-sidebar-terminal");
    assert.strictEqual(
      packageJSON.description,
      "sidebar terminal Extension for VS Code with tmux, zellij, and native terminal support",
    );
    assert.strictEqual(container.title, "ULW");
    assert.strictEqual(packageJSON.contributes?.configuration?.title, "ULW");
  });

  test("contributes ULW command palette labels while preserving command IDs", async () => {
    const packageJSON = await getPackageJSON();
    const commands = packageJSON.contributes?.commands ?? [];
    const start = commands.find(({ command }) => command === "ulw.start");
    const focus = commands.find(({ command }) => command === "ulw.focus");

    assert.deepStrictEqual(start, {
      command: "ulw.start",
      title: "Start ULW Terminal",
      category: "ULW",
    });
    assert.deepStrictEqual(focus, {
      command: "ulw.focus",
      title: "ULW: Focus Terminal",
    });
    assert.ok(
      commands.every(({ category }) => category !== "Open Sidebar Terminal"),
      "commands should not use old product category",
    );
  });

  test("contributes terminal view metadata", async () => {
    const packageJSON = await getPackageJSON();
    const views = packageJSON.contributes?.views?.ulwContainer ?? [];
    const terminalView = views.find(({ id }) => id === "ulw");

    assert.ok(terminalView, "ulw webview should be contributed");
    assert.strictEqual(terminalView.type, "webview");
    assert.strictEqual(terminalView.icon, "resources/ulwcode-sidebar.svg");
    assert.strictEqual(
      terminalView.when,
      undefined,
      "ulw terminal view should remain available in the secondary sidebar",
    );
  });

  test("contributes editor and explorer context menus", async () => {
    const packageJSON = await getPackageJSON();
    const menus = packageJSON.contributes?.menus;
    const viewTitle = menus?.["view/title"] ?? [];
    const editorContext = menus?.["editor/context"] ?? [];
    const explorerContext = menus?.["explorer/context"] ?? [];
    const titleCommands = viewTitle.map(({ command }) => command);

    assert.deepStrictEqual(titleCommands, [
      "ulw.openNewSessionTerminalInEditor",
      "ulw.tmuxSplitPaneH",
      "ulw.tmuxSplitPaneV",
      "ulw.tmuxPrevWindow",
      "ulw.tmuxCreateWindow",
      "ulw.tmuxNextWindow",
      "ulw.toggleTmuxCommandToolbar",
      "ulw.toggleDashboard",
      "ulw.tmuxRefresh",
    ]);
    assert.ok(
      viewTitle.every(({ when }) => when === "view == ulw"),
      "view/title actions should stay scoped to the ULW sidebar view",
    );

    assert.ok(
      editorContext.some(
        ({ command, group }) =>
          command === "ulw.sendAtMention" && group === "navigation",
      ),
      "editor/context should include sendAtMention",
    );
    assert.ok(
      explorerContext.some(
        ({ command, group, when }) =>
          command === "ulw.sendFileToTerminal" &&
          group === "2_workspace" &&
          when === "!explorerResourceIsFolder",
      ),
      "explorer/context should include file send command",
    );
    assert.ok(
      explorerContext.some(
        ({ command, group, when }) =>
          command === "ulw.sendFileToTerminal" &&
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
        command: "ulw.sendAtMention",
        key: "ctrl+alt+l",
        mac: "cmd+alt+l",
      },
      {
        command: "ulw.sendAllOpenFiles",
        key: "ctrl+alt+a",
        mac: "cmd+alt+a",
      },
      {
        command: "ulw.browseTmuxSessions",
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
