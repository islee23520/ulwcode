import * as assert from "assert";
import * as vscode from "vscode";

interface ConfigurationProperty {
  type?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  items?: ConfigurationProperty;
  required?: string[];
  properties?: Record<string, ConfigurationProperty>;
}

interface ConfigurationSpec {
  type: string;
  defaultValue: unknown;
  minimum?: number;
  maximum?: number;
  enumValues?: string[];
  itemType?: string;
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

const nerdFontStack =
  "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'CascadiaCode NF', Menlo, monospace";

const configurationSpecs: Record<string, ConfigurationSpec> = {
  "ulw.fontSize": {
    type: "number",
    defaultValue: 14,
    minimum: 6,
    maximum: 25,
  },
  "ulw.fontFamily": {
    type: "string",
    defaultValue: nerdFontStack,
  },
  "ulw.cursorBlink": { type: "boolean", defaultValue: true },
  "ulw.cursorStyle": {
    type: "string",
    defaultValue: "block",
    enumValues: ["block", "underline", "bar"],
  },
  "ulw.scrollback": {
    type: "number",
    defaultValue: 10000,
    minimum: 0,
    maximum: 100000,
  },
  "ulw.autoFocusOnSend": { type: "boolean", defaultValue: true },
  "ulw.autoStartOnOpen": { type: "boolean", defaultValue: true },
  "ulw.shellPath": { type: "string", defaultValue: "" },
  "ulw.shellArgs": {
    type: "array",
    defaultValue: [],
    itemType: "string",
  },
  "ulw.sendKeybindingsToShell": {
    type: "boolean",
    defaultValue: true,
  },
  "ulw.showTmuxWindowControls": {
    type: "boolean",
    defaultValue: true,
  },
  "ulw.autoShareContext": { type: "boolean", defaultValue: true },
  "ulw.httpTimeout": {
    type: "number",
    defaultValue: 5000,
    minimum: 1000,
    maximum: 30000,
  },
  "ulw.enableHttpApi": { type: "boolean", defaultValue: true },
  "ulw.logLevel": {
    type: "string",
    defaultValue: "info",
    enumValues: ["debug", "info", "warn", "error"],
  },
  "ulw.contextDebounceMs": {
    type: "number",
    defaultValue: 500,
    minimum: 100,
    maximum: 5000,
  },
  "ulw.maxDiagnosticLength": {
    type: "number",
    defaultValue: 500,
    minimum: 100,
    maximum: 2000,
  },
  "ulw.enableAutoSpawn": { type: "boolean", defaultValue: true },
  "ulw.terminalBackend": {
    type: "string",
    defaultValue: "tmux",
    enumValues: ["native", "tmux", "zellij"],
  },
  "ulw.terminal.defaultLocation": {
    type: "string",
    defaultValue: "editor",
    enumValues: ["editor", "sidebar"],
  },
  "ulw.collapseSecondaryBarOnEditorOpen": {
    type: "boolean",
    defaultValue: true,
  },
  "ulw.codeActionSeverities": {
    type: "array",
    defaultValue: ["error", "warning"],
    itemType: "string",
  },
  "ulw.aiTools": { type: "array", defaultValue: undefined },
  "ulw.defaultAiTool": { type: "string", defaultValue: "opencode" },
  "ulw.pane.defaultSplitDirection": {
    type: "string",
    defaultValue: "horizontal",
    enumValues: ["horizontal", "vertical"],
  },
  "ulw.pane.focusOnClick": {
    type: "boolean",
    defaultValue: true,
  },
  "ulw.pane.showPaneActions": {
    type: "boolean",
    defaultValue: true,
  },
  "ulw.pane.renderer": {
    type: "string",
    defaultValue: "auto",
    enumValues: ["webgl", "canvas", "auto"],
  },
  "ulw.projectList.openedOnly": {
    type: "boolean",
    defaultValue: true,
  },
};

function assertConfigurationProperty(
  id: string,
  property: ConfigurationProperty | undefined,
  spec: ConfigurationSpec,
): void {
  assert.ok(property, `${id} should be contributed`);
  assert.strictEqual(property.type, spec.type, `${id} should have expected type`);

  if (id !== "ulw.aiTools") {
    assert.deepStrictEqual(
      property.default,
      spec.defaultValue,
      `${id} should have expected default`,
    );
  }

  if (spec.minimum !== undefined) {
    assert.strictEqual(property.minimum, spec.minimum);
  }

  if (spec.maximum !== undefined) {
    assert.strictEqual(property.maximum, spec.maximum);
  }

  if (spec.enumValues) {
    assert.deepStrictEqual(property.enum, spec.enumValues);
  }

  if (spec.itemType) {
    assert.strictEqual(property.items?.type, spec.itemType);
  }
}

suite("Comprehensive configuration contributions", () => {
  test("contributes exactly the expected 30 configuration properties", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const expectedPropertyIds = Object.keys(configurationSpecs).sort();

    assert.strictEqual(expectedPropertyIds.length, 30);
    assert.deepStrictEqual(Object.keys(properties).sort(), expectedPropertyIds);
  });

  for (const [id, spec] of Object.entries(configurationSpecs)) {
    test(`defines ${id} metadata`, async () => {
      const extension = await activateExtension();
      const properties = getConfigurationProperties(extension);

      assertConfigurationProperty(id, properties[id], spec);
    });
  }

  test("defines aiTools object schema and default tools", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const aiTools = properties["ulw.aiTools"];

    assert.strictEqual(aiTools?.type, "array");
    assert.strictEqual(aiTools?.items?.type, "object");
    assert.deepStrictEqual(aiTools?.items?.required, ["name", "label"]);
    assert.strictEqual(aiTools?.items?.properties?.name?.type, "string");
    assert.strictEqual(aiTools?.items?.properties?.label?.type, "string");
    assert.strictEqual(aiTools?.items?.properties?.path?.type, "string");
    assert.strictEqual(aiTools?.items?.properties?.args?.type, "array");
    assert.strictEqual(aiTools?.items?.properties?.aliases?.type, "array");
    assert.strictEqual(aiTools?.items?.properties?.operator?.type, "string");
    assert.deepStrictEqual(aiTools?.default, [
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

suite("Runtime configuration defaults", () => {
  test("reads key defaults from vscode.workspace.getConfiguration", async () => {
    await activateExtension();

    const config = vscode.workspace.getConfiguration("ulw");
    const defaultValue = (key: string): unknown =>
      config.inspect(key)?.defaultValue;

    assert.strictEqual(defaultValue("defaultAiTool"), "opencode");
    assert.deepStrictEqual(defaultValue("aiTools"), [
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
    assert.strictEqual(defaultValue("terminalBackend"), "tmux");
    assert.strictEqual(defaultValue("autoStartOnOpen"), true);
    assert.strictEqual(defaultValue("enableHttpApi"), true);
    assert.strictEqual(defaultValue("fontSize"), 14);
  });
});
