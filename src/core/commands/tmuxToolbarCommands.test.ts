import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { registerTmuxToolbarCommands } from "./tmuxToolbarCommands";
import type { TerminalProvider } from "../../providers/TerminalProvider";

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../../test/mocks/vscode");
  return actual;
});

describe("registerTmuxToolbarCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers toggleTmuxCommandToolbar and calls provider", () => {
    const toggleTmuxCommandToolbar = vi.fn();
    const provider: Pick<TerminalProvider, "toggleTmuxCommandToolbar"> = {
      toggleTmuxCommandToolbar,
    };
    registerTmuxToolbarCommands({ provider });
    const call = vi
      .mocked(vscode.commands.registerCommand)
      .mock.calls.find((c) => c[0] === "ulw.toggleTmuxCommandToolbar");
    const handler = call?.[1];
    expect(handler).toBeTypeOf("function");
    if (typeof handler !== "function") {
      throw new Error("toggleTmuxCommandToolbar command handler was not registered");
    }
    handler();
    expect(toggleTmuxCommandToolbar).toHaveBeenCalledTimes(1);
  });
});
