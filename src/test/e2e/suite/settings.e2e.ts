import * as assert from "assert";
import * as vscode from "vscode";

interface ConfigurationProperty {
  type?: string;
  default?: unknown;
  items?: unknown;
  required?: string[];
  properties?: Record<string, ConfigurationProperty>;
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

suite("AI tool settings", () => {
  test("projectList.openedOnly defaults to true", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    assert.strictEqual(
      properties["ulw.projectList.openedOnly"]?.default,
      true,
    );
  });

  test('defaultAiTool defaults to "opencode"', async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    assert.strictEqual(
      properties["ulw.defaultAiTool"]?.default,
      "opencode",
    );
  });

  test("aiTools config structure is correct", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const aiTools = properties["ulw.aiTools"];

    assert.ok(aiTools, "ulw.aiTools should be contributed");
    assert.strictEqual(aiTools.type, "array");

    const items = aiTools.items as ConfigurationProperty | undefined;
    assert.ok(items, "ulw.aiTools should define array item schema");
    assert.strictEqual(items.type, "object");
    assert.deepStrictEqual(items.required, ["name", "label"]);

    const itemProperties = items.properties;
    assert.ok(itemProperties, "AI tool item schema should define properties");
    assert.strictEqual(itemProperties.name?.type, "string");
    assert.strictEqual(itemProperties.label?.type, "string");
    assert.strictEqual(itemProperties.path?.type, "string");
    assert.strictEqual(itemProperties.args?.type, "array");
    assert.strictEqual(itemProperties.aliases?.type, "array");
    assert.strictEqual(itemProperties.operator?.type, "string");

    assert.deepStrictEqual(aiTools.default, [
      {
        name: "opencode",
        label: "OpenCode",
        path: "",
        args: [],
        operator: "opencode",
      },
      {
        name: "claude",
        label: "Claude",
        path: "",
        args: [],
        aliases: ["claude"],
        operator: "claude",
      },
      {
        name: "codex",
        label: "Codex",
        path: "",
        args: [],
        operator: "codex",
      },
    ]);
  });
});
