import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

interface CommandContribution {
  readonly command: string;
  readonly title: string;
  readonly category?: string;
}

interface PackageManifest {
  readonly name: string;
  readonly publisher: string;
  readonly displayName: string;
  readonly description: string;
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
        readonly when?: string;
      }[];
    };
    readonly commands: readonly CommandContribution[];
    readonly configuration: {
      readonly title: string;
      readonly properties: {
        readonly "ulw.aiTools": {
          readonly default: readonly {
            readonly name: string;
            readonly label: string;
            readonly operator: string;
          }[];
        };
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

    expect(manifest.name).toBe("ulwcode");
    expect(manifest.publisher).toBe("islee23520");
    expect(manifest.displayName).toBe("ULW");
    expect(manifest.description).toBe(
      "Open TUI terminal MUX for VS Code with tmux, zellij, and native terminal support",
    );
    expect(manifest.keywords).toEqual(
      expect.arrayContaining(["opencode", "ulw", "open-tui", "mux"]),
    );
    const container = manifest.contributes.viewsContainers.secondarySidebar.find(
      ({ id }) => id === "ulwContainer",
    );
    expect(container?.title).toBe("ULW");
    expect(container?.icon).toBe("resources/ulwcode-activity-bar.svg");
    expect(manifest.contributes.configuration.title).toBe("ULW");
  });

  it("uses ULW command palette labels without renaming command IDs", () => {
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

  it("keeps OpenCode as the default AI tool label and operator", () => {
    const tools =
      readManifest().contributes.configuration.properties["ulw.aiTools"]
        .default;

    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "opencode",
          label: "OpenCode",
          operator: "opencode",
        }),
        expect.objectContaining({ name: "claude", label: "Claude" }),
        expect.objectContaining({ name: "codex", label: "Codex" }),
      ]),
    );
  });

  it("defaults the terminal identity to editor while making the sidebar opt-in", () => {
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
    expect(terminalView?.when).toBe(
      "config.ulw.terminal.defaultLocation == 'sidebar'",
    );
  });
});
