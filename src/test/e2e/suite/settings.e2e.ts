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

suite("ULW settings", () => {
  test("projectList.openedOnly defaults to true", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    assert.strictEqual(
      properties["ulw.projectList.openedOnly"]?.default,
      true,
    );
  });
});
