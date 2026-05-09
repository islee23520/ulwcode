import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type * as vscodeTypes from "../test/mocks/vscode";

const promptFormatterMocks = vi.hoisted(() => ({
  formatDiagnostic: vi.fn(() => "FORMATTED_PRIMARY"),
  formatDiagnostics: vi.fn(() => "FORMATTED_CONTEXT"),
}));

vi.mock("../utils/PromptFormatter", () => ({
  formatDiagnostic: promptFormatterMocks.formatDiagnostic,
  formatDiagnostics: promptFormatterMocks.formatDiagnostics,
}));

const vscodeMock = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

import { OpenCodeCodeActionProvider } from "./CodeActionProvider";

describe("OpenCodeCodeActionProvider", () => {
  const makeDiagnostic = (
    severity: vscode.DiagnosticSeverity,
    message: string,
  ): vscode.Diagnostic =>
    ({
      severity,
      message,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      },
    }) as vscode.Diagnostic;

  const makeDocument = (): vscode.TextDocument => {
    const uri = vscode.Uri.file("/workspace/src/example.ts");
    return new vscodeMock.TextDocument(uri, "const value = 1;") as any;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "codeActionSeverities") {
          return ["error", "warning"];
        }

        if (key === "maxDiagnosticLength") {
          return 500;
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as any);
  });

  it("provideCodeActions returns empty array for no diagnostics", () => {
    const contextManager = { getDiagnostics: vi.fn(() => []) };
    const sendPrompt = vi.fn(async () => {});
    const provider = new OpenCodeCodeActionProvider(
      contextManager as any,
      sendPrompt,
    );

    const actions = provider.provideCodeActions(
      makeDocument(),
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      } as any,
      {
        diagnostics: [],
        triggerKind: 1,
        only: undefined,
      } as unknown as vscode.CodeActionContext,
      { isCancellationRequested: false } as vscode.CancellationToken,
    );

    expect(actions).toEqual([]);
  });

  it("returns actions only for configured severity levels", () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "codeActionSeverities") {
          return ["error"];
        }

        if (key === "maxDiagnosticLength") {
          return 500;
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as any);

    const contextManager = { getDiagnostics: vi.fn(() => []) };
    const sendPrompt = vi.fn(async () => {});
    const provider = new OpenCodeCodeActionProvider(
      contextManager as any,
      sendPrompt,
    );

    const errorDiagnostic = makeDiagnostic(
      vscode.DiagnosticSeverity.Error,
      "error message",
    );
    const warningDiagnostic = makeDiagnostic(
      vscode.DiagnosticSeverity.Warning,
      "warning message",
    );

    const actions = provider.provideCodeActions(
      makeDocument(),
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      } as any,
      {
        diagnostics: [errorDiagnostic, warningDiagnostic],
        triggerKind: 1,
        only: undefined,
      } as unknown as vscode.CodeActionContext,
      { isCancellationRequested: false } as vscode.CancellationToken,
    );

    expect(actions).toHaveLength(1);
    expect(
      actions.every((action) => action.diagnostics?.[0] === errorDiagnostic),
    ).toBe(true);
  });

  it("returns empty when diagnostics do not match configured severities", () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "codeActionSeverities") {
          return ["error"];
        }

        if (key === "maxDiagnosticLength") {
          return 500;
        }

        return defaultValue;
      }),
      update: vi.fn(),
    } as any);

    const contextManager = { getDiagnostics: vi.fn(() => []) };
    const sendPrompt = vi.fn(async () => {});
    const provider = new OpenCodeCodeActionProvider(
      contextManager as any,
      sendPrompt,
    );

    const warningDiagnostic = makeDiagnostic(
      vscode.DiagnosticSeverity.Warning,
      "warning message",
    );

    const actions = provider.provideCodeActions(
      makeDocument(),
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      } as any,
      {
        diagnostics: [warningDiagnostic],
        triggerKind: 1,
        only: undefined,
      } as unknown as vscode.CodeActionContext,
      { isCancellationRequested: false } as vscode.CancellationToken,
    );

    expect(actions).toEqual([]);
  });

  it("action has correct title and command", () => {
    const contextManager = { getDiagnostics: vi.fn(() => []) };
    const sendPrompt = vi.fn(async () => {});
    const provider = new OpenCodeCodeActionProvider(
      contextManager as any,
      sendPrompt,
    );

    const diagnostic = makeDiagnostic(vscode.DiagnosticSeverity.Error, "error");
    const actions = provider.provideCodeActions(
      makeDocument(),
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      } as any,
      {
        diagnostics: [diagnostic],
        triggerKind: 1,
        only: undefined,
      } as unknown as vscode.CodeActionContext,
      { isCancellationRequested: false } as vscode.CancellationToken,
    );

    const fixAction = actions.find(
      (action) => action.title === "Explain and Fix (Terminal)",
    );

    expect(fixAction).toBeDefined();
    expect(fixAction?.command?.command).toBe("opencodeTui.explainAndFix");
  });

  it("command handler formats and sends prompt", async () => {
    const diagnostic = makeDiagnostic(vscode.DiagnosticSeverity.Error, "error");
    const document = makeDocument();

    const contextManager = {
      getDiagnostics: vi.fn(() => [diagnostic]),
    };
    const sendPrompt = vi.fn(async () => {});

    const provider = new OpenCodeCodeActionProvider(
      contextManager as any,
      sendPrompt,
    );

    provider.registerCommand();

    const registerCalls = vi.mocked(vscode.commands.registerCommand).mock.calls;
    const explainAndFixRegistration = registerCalls.find(
      (call) => call[0] === "opencodeTui.explainAndFix",
    );

    expect(explainAndFixRegistration).toBeDefined();

    const handler = explainAndFixRegistration?.[1] as (
      args: unknown,
    ) => Promise<void>;

    await handler({
      diagnostic,
      documentUri: document.uri.path,
    });

    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt).toHaveBeenCalledWith(
      expect.stringContaining("FORMATTED_PRIMARY"),
    );
  });

  it("command handler safely ignores invalid arguments", async () => {
    const contextManager = {
      getDiagnostics: vi.fn(() => []),
    };
    const sendPrompt = vi.fn(async () => {});

    const provider = new OpenCodeCodeActionProvider(
      contextManager as any,
      sendPrompt,
    );

    provider.registerCommand();
    const registerCalls = vi.mocked(vscode.commands.registerCommand).mock.calls;
    const explainAndFixRegistration = registerCalls.find(
      (call) => call[0] === "opencodeTui.explainAndFix",
    );
    const handler = explainAndFixRegistration?.[1] as () => Promise<void>;

    await handler();

    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("command handler shows error when appendPrompt fails", async () => {
    const diagnostic = makeDiagnostic(vscode.DiagnosticSeverity.Error, "error");
    const document = makeDocument();
    const contextManager = {
      getDiagnostics: vi.fn(() => [diagnostic]),
    };
    const sendPrompt = vi.fn(async () => {
      throw new Error("network fail");
    });

    const provider = new OpenCodeCodeActionProvider(
      contextManager as any,
      sendPrompt,
    );

    provider.registerCommand();
    const registerCalls = vi.mocked(vscode.commands.registerCommand).mock.calls;
    const explainAndFixRegistration = registerCalls.find(
      (call) => call[0] === "opencodeTui.explainAndFix",
    );
    const handler = explainAndFixRegistration?.[1] as (
      args: unknown,
    ) => Promise<void>;

    await handler({
      diagnostic,
      documentUri: document.uri.path,
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send diagnostic prompt"),
    );
  });

  it("command handler stringifies non-Error failures", async () => {
    const diagnostic = makeDiagnostic(vscode.DiagnosticSeverity.Error, "error");
    const document = makeDocument();
    const contextManager = {
      getDiagnostics: vi.fn(() => [diagnostic]),
    };
    const sendPrompt = vi.fn(async () => {
      throw "network offline";
    });

    const provider = new OpenCodeCodeActionProvider(
      contextManager as any,
      sendPrompt,
    );

    provider.registerCommand();
    const registerCalls = vi.mocked(vscode.commands.registerCommand).mock.calls;
    const explainAndFixRegistration = registerCalls.find(
      (call) => call[0] === "opencodeTui.explainAndFix",
    );
    const handler = explainAndFixRegistration?.[1] as (
      args: unknown,
    ) => Promise<void>;

    await handler({
      diagnostic,
      documentUri: document.uri.path,
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Failed to send diagnostic prompt: network offline",
    );
  });

  it("integrates with PromptFormatter", async () => {
    const targetDiagnostic = makeDiagnostic(
      vscode.DiagnosticSeverity.Error,
      "target",
    );
    const relatedDiagnostic = makeDiagnostic(
      vscode.DiagnosticSeverity.Warning,
      "related",
    );
    const document = makeDocument();

    const contextManager = {
      getDiagnostics: vi.fn(() => [targetDiagnostic, relatedDiagnostic]),
    };
    const sendPrompt = vi.fn(async () => {});

    const provider = new OpenCodeCodeActionProvider(
      contextManager as any,
      sendPrompt,
    );

    provider.registerCommand();
    const registerCalls = vi.mocked(vscode.commands.registerCommand).mock.calls;
    const explainAndFixRegistration = registerCalls.find(
      (call) => call[0] === "opencodeTui.explainAndFix",
    );

    const handler = explainAndFixRegistration?.[1] as (
      args: unknown,
    ) => Promise<void>;

    await handler({
      diagnostic: targetDiagnostic,
      documentUri: document.uri.path,
    });

    expect(promptFormatterMocks.formatDiagnostic).toHaveBeenCalledWith(
      targetDiagnostic,
      expect.objectContaining({ path: document.uri.path }),
      500,
    );
    expect(promptFormatterMocks.formatDiagnostics).toHaveBeenCalledWith(
      [relatedDiagnostic],
      expect.objectContaining({ path: document.uri.path }),
      500,
    );
    expect(contextManager.getDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ path: document.uri.path }),
    );
  });
});
