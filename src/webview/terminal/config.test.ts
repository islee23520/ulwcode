// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { readTerminalConfig } from "./config";

describe("readTerminalConfig", () => {
  it("reads the configured terminal renderer", () => {
    const element = document.createElement("div");
    element.dataset.renderer = "canvas";

    const config = readTerminalConfig(element);

    expect(config.renderer).toBe("canvas");
  });

  it("falls back to auto for unknown renderer values", () => {
    const element = document.createElement("div");
    element.dataset.renderer = "unsupported";

    const config = readTerminalConfig(element);

    expect(config.renderer).toBe("auto");
  });
});
