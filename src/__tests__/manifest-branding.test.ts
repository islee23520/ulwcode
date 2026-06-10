import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

interface CommandContribution {
  readonly command: string;
  readonly title: string;
  readonly category?: string;
  readonly icon?: string | { readonly light: string; readonly dark: string };
}

interface PackageManifest {
  readonly name: string;
  readonly publisher: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly keywords: readonly string[];
  readonly contributes: {
    readonly viewsContainers: {
      readonly secondarySidebar: readonly {
        readonly id: string;
        readonly title: string;
        readonly icon: string;
      }[];
    };
    readonly views: {
      readonly ulwContainer: readonly {
        readonly id: string;
        readonly icon: string;
        readonly when?: string;
      }[];
    };
    readonly commands: readonly CommandContribution[];
    readonly configuration: {
      readonly title: string;
      readonly properties: {
        readonly "ulw.terminal.defaultLocation": {
          readonly default: string;
          readonly enum: readonly string[];
        };
      };
    };
  };
}

function readManifest(): PackageManifest {
  return JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf-8"),
  ) as PackageManifest;
}

function findCommand(
  commands: readonly CommandContribution[],
  commandId: string,
): CommandContribution {
  const command = commands.find(({ command }) => command === commandId);
  if (!command) {
    throw new Error(`${commandId} should be contributed`);
  }
  return command;
}

describe("package manifest branding", () => {
  it("uses ULW product branding while preserving extension identity", () => {
    const manifest = readManifest();

    expect(manifest.name).toBe("opencode-sidebar-tui");
    expect(manifest.publisher).toBe("islee23520");
    expect(manifest.version).toBe("1.12.1");
    expect(manifest.displayName).toBe("ulwcode-sidebar-terminal");
    expect(manifest.description).toBe(
      "sidebar terminal Extension for VS Code with tmux, zellij, and native terminal support",
    );
    expect(manifest.keywords).toEqual(["terminal", "sidebar", "tui", "ai"]);
    const container = manifest.contributes.viewsContainers.secondarySidebar.find(
      ({ id }) => id === "ulwContainer",
    );
    expect(container?.title).toBe("ULW");
    expect(manifest.contributes.configuration.title).toBe("ULW");
  });

  it("uses ULW command palette labels with ulw command IDs", () => {
    const commands = readManifest().contributes.commands;

    expect(findCommand(commands, "ulw.start")).toMatchObject({
      command: "ulw.start",
      title: "Start ULW Terminal",
      category: "ULW",
    });
    expect(findCommand(commands, "ulw.focus")).toMatchObject({
      command: "ulw.focus",
      title: "ULW: Focus Terminal",
    });
    expect(findCommand(commands, "ulw.openInNewWindow")).toMatchObject({
      command: "ulw.openInNewWindow",
      category: "ULW",
    });
    expect(commands.every(({ category }) => category !== "Open Sidebar Terminal"))
      .toBe(true);
    expect(
      commands
        .filter(({ category }) => category === "ULW")
        .every(({ title }) => !title.startsWith("ULW:")),
    ).toBe(true);
  });

  it("uses distinct title-bar icons for horizontal and vertical split actions", () => {
    const commands = readManifest().contributes.commands;

    expect(findCommand(commands, "ulw.tmuxSplitPaneH")).toMatchObject({
      title: "Split Pane Side by Side",
      icon: "$(split-horizontal)",
    });
    expect(findCommand(commands, "ulw.tmuxSplitPaneV")).toMatchObject({
      title: "Split Pane Top/Bottom",
      icon: "$(split-vertical)",
    });
  });

  it("keeps the sidebar terminal view contributed while defaulting start location to editor", () => {
    const manifest = readManifest();
    const locationSetting =
      manifest.contributes.configuration.properties[
        "ulw.terminal.defaultLocation"
      ];
    const terminalView = manifest.contributes.views.ulwContainer.find(
      ({ id }) => id === "ulw",
    );

    expect(locationSetting.default).toBe("editor");
    expect(locationSetting.enum).toEqual(["editor", "sidebar"]);
    expect(terminalView?.when).toBeUndefined();
  });

  it("uses the sidebar-optimized icon for the activity container and terminal view", () => {
    const manifest = readManifest();
    const iconPath = "resources/ulwcode-sidebar.svg";
    const container = manifest.contributes.viewsContainers.secondarySidebar.find(
      ({ id }) => id === "ulwContainer",
    );
    const terminalView = manifest.contributes.views.ulwContainer.find(
      ({ id }) => id === "ulw",
    );
    const svg = readFileSync(join(process.cwd(), iconPath), "utf-8");

    expect(container?.icon).toBe(iconPath);
    expect(terminalView?.icon).toBe(iconPath);
    expect(svg).toContain('width="24"');
    expect(svg).toContain('height="24"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toContain("<text");
  });

  it("cleans generated dist output before webpack builds", () => {
    const { scripts } = readManifest() as unknown as {
      readonly scripts: Record<string, string>;
    };

    expect(scripts.compile).toContain("rmSync('dist'");
    expect(scripts.package).toContain("rmSync('dist'");
    expect(scripts.package).toContain("webpack --mode production");
    expect(scripts["vscode:prepublish"]).toBe("npm run package");
  });
});
