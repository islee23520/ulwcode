import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

type Manifest = {
  readonly activationEvents?: readonly string[];
  readonly contributes: {
    readonly commands?: readonly unknown[];
    readonly keybindings?: readonly unknown[];
    readonly menus?: Readonly<Record<string, readonly unknown[]>>;
    readonly viewsContainers: Readonly<
      Record<string, readonly { readonly id: string }[]>
    >;
    readonly views: Readonly<
      Record<string, readonly { readonly id: string; readonly type: string }[]>
    >;
    readonly configuration: {
      readonly properties: Readonly<Record<string, unknown>>;
    };
  };
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
};

function readManifest(): Manifest {
  return JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as Manifest;
}

describe("minimal sidebar terminal topology", () => {
  it("activates only through the contributed sidebar view", () => {
    const manifest = readManifest();

    expect(manifest.activationEvents).toBeUndefined();
    expect(Object.keys(manifest.contributes.viewsContainers)).toEqual([
      "secondarySidebar",
    ]);
    expect(manifest.contributes.viewsContainers.secondarySidebar).toEqual([
      expect.objectContaining({ id: "ulwContainer" }),
    ]);
    expect(manifest.contributes.views.ulwContainer).toEqual([
      expect.objectContaining({ id: "ulw", type: "webview" }),
    ]);
  });

  it("exposes no auxiliary commands menus or keybindings", () => {
    const contributes = readManifest().contributes;

    expect(contributes.commands).toBeUndefined();
    expect(contributes.menus).toBeUndefined();
    expect(contributes.keybindings).toBeUndefined();
  });

  it("keeps only terminal and shell settings", () => {
    const propertyNames = Object.keys(
      readManifest().contributes.configuration.properties,
    ).sort();

    expect(propertyNames).toEqual([
      "ulw.cursorBlink",
      "ulw.cursorStyle",
      "ulw.fontFamily",
      "ulw.fontSize",
      "ulw.scrollback",
      "ulw.shellArgs",
      "ulw.shellPath",
    ]);
  });

  it("ships only node-pty and bundles xterm at build time", () => {
    const manifest = readManifest();
    expect(Object.keys(manifest.dependencies)).toEqual(["node-pty"]);
    expect(Object.keys(manifest.devDependencies)).toEqual(
      expect.arrayContaining([
      "@xterm/addon-fit",
      "@xterm/xterm",
      ]),
    );
  });
});
