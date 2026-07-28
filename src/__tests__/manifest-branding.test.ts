import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as {
  readonly displayName: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly contributes: {
    readonly views: Readonly<Record<string, readonly unknown[]>>;
  };
};

describe("extension manifest", () => {
  it("describes only the native sidebar terminal", () => {
    expect(manifest.displayName).toBe("ULW Sidebar Terminal");
    expect(manifest.description).toContain("native shell terminal");
    expect(manifest.keywords).toEqual(["terminal", "sidebar", "shell"]);
    expect(manifest.contributes.views.ulwContainer).toHaveLength(1);
  });
});
