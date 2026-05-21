import * as assert from "assert";
import * as vscode from "vscode";

interface ConfigurationProperty {
  type?: string;
  default?: unknown;
  enum?: string[];
  items?: {
    type?: string;
    properties?: Record<string, ConfigurationProperty>;
  };
}

interface AiToolDefault {
  name: string;
  label: string;
  path: string;
  args: string[];
  aliases?: string[];
  operator: string;
}

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension(
    "islee23520.opencode-sidebar-tui",
  );

  assert.ok(extension, "Extension should be available in the test host");
  await extension.activate();
  return extension;
}

function getConfigurationProperties(
  extension: vscode.Extension<unknown>,
): Record<string, ConfigurationProperty> {
  const packageJSON = extension.packageJSON as {
    contributes?: {
      configuration?: {
        properties?: Record<string, ConfigurationProperty>;
      };
    };
  };

  const properties = packageJSON.contributes?.configuration?.properties;
  assert.ok(properties, "Extension should contribute configuration properties");
  return properties;
}

suite("AI tool selector E2E surface", () => {
  test("contributes promptAiToolOnSession with expected type and default", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const promptAiToolOnSession = properties["opencodeTui.promptAiToolOnSession"];

    assert.strictEqual(promptAiToolOnSession?.type, "boolean");
    assert.strictEqual(promptAiToolOnSession?.default, true);
  });

  test("contributes defaultAiTool as opencode", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const defaultAiTool = properties["opencodeTui.defaultAiTool"];

    assert.strictEqual(defaultAiTool?.type, "string");
    assert.strictEqual(defaultAiTool?.default, "opencode");
  });

  test("defines the default AI tool selector entries", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const aiTools = properties["opencodeTui.aiTools"];
    const defaults = aiTools?.default as AiToolDefault[] | undefined;

    assert.strictEqual(aiTools?.type, "array");
    assert.ok(Array.isArray(defaults), "aiTools default should be an array");
    assert.strictEqual(defaults.length, 3);
    assert.deepStrictEqual(
      defaults.map(({ name }) => name),
      ["opencode", "claude", "codex"],
    );

    for (const tool of defaults) {
      assert.strictEqual(typeof tool.name, "string");
      assert.strictEqual(typeof tool.label, "string");
      assert.strictEqual(typeof tool.path, "string");
      assert.ok(Array.isArray(tool.args), `${tool.name} args should be array`);
      assert.strictEqual(typeof tool.operator, "string");
    }

    const claude = defaults.find(({ name }) => name === "claude");
    assert.deepStrictEqual(claude?.aliases, ["claude"]);
  });

  test("defines AI tool item schema required by the selector", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const itemProperties = properties["opencodeTui.aiTools"]?.items?.properties;

    assert.strictEqual(itemProperties?.name?.type, "string");
    assert.strictEqual(itemProperties?.label?.type, "string");
    assert.strictEqual(itemProperties?.path?.type, "string");
    assert.strictEqual(itemProperties?.args?.type, "array");
    assert.strictEqual(itemProperties?.aliases?.type, "array");
    assert.strictEqual(itemProperties?.operator?.type, "string");
  });

  test("supports available terminal backends for selector launch flows", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const terminalBackend = properties["opencodeTui.terminalBackend"];

    assert.strictEqual(terminalBackend?.type, "string");
    assert.deepStrictEqual(terminalBackend?.enum, ["native", "tmux", "zellij"]);
  });

  test("registers selector-triggering and dashboard commands", async () => {
    await activateExtension();
    const commands = await vscode.commands.getCommands(true);
    const expectedCommands = [
      "opencodeTui.switchTmuxSession",
      "opencodeTui.browseTmuxSessions",
      "opencodeTui.switchNativeShell",
      "opencodeTui.toggleDashboard",
      "opencodeTui.openDashboardInEditor",
    ];

    for (const command of expectedCommands) {
      assert.ok(commands.includes(command), `${command} should be registered`);
    }
  });
});
