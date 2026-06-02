import { describe, expect, it, vi } from "vitest";

import { createLinkProvider } from "./index";
import { postMessage } from "../shared/vscode-api";

vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
}));

type LinkProvider = ReturnType<typeof createLinkProvider>;
type ProvidedLinks = Parameters<Parameters<LinkProvider["provideLinks"]>[1]>[0];
type LinkTerminal = Parameters<typeof createLinkProvider>[0];

function createTerminalForLine(
  lineText: string,
  onGetLine?: (lineNumber: number) => void,
): LinkTerminal {
  return {
    buffer: {
      active: {
        getLine: (lineNumber: number) => {
          onGetLine?.(lineNumber);
          return {
            translateToString: () => lineText,
          };
        },
      },
    },
  };
}

function collectLinks(lineText: string): NonNullable<ProvidedLinks> {
  let collected: ProvidedLinks;
  createLinkProvider(createTerminalForLine(lineText)).provideLinks(
    1,
    (links) => {
      collected = links;
    },
  );

  return collected ?? [];
}

describe("createLinkProvider", () => {
  it("links opencode relative paths at the beginning of a line", () => {
    const links = collectLinks("src/providers/MessageRouter.ts:478:12");

    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe("src/providers/MessageRouter.ts");
    expect(links[0]?.range).toEqual({
      start: { x: 1, y: 1 },
      end: { x: 30, y: 1 },
    });
    links[0]?.activate();

    expect(postMessage).toHaveBeenCalledWith({
      type: "openFile",
      path: "src/providers/MessageRouter.ts",
      line: 478,
      endLine: undefined,
      column: 12,
    });
  });

  it("links single filename references with line anchors", () => {
    const links = collectLinks("README.md#L83");

    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe("README.md");
    expect(links[0]?.range).toEqual({
      start: { x: 1, y: 1 },
      end: { x: 9, y: 1 },
    });
    links[0]?.activate();

    expect(postMessage).toHaveBeenCalledWith({
      type: "openFile",
      path: "README.md",
      line: 83,
      endLine: undefined,
      column: undefined,
    });
  });

  it("reads the zero-based buffer line for one-based xterm link coordinates", () => {
    const requestedLines: number[] = [];
    let collected: ProvidedLinks;

    createLinkProvider(
      createTerminalForLine("src/webview/links/index.ts:42", (lineNumber) => {
        requestedLines.push(lineNumber);
      }),
    ).provideLinks(5, (links) => {
      collected = links;
    });

    expect(requestedLines).toEqual([4]);
    expect(collected?.[0]?.range).toEqual({
      start: { x: 1, y: 5 },
      end: { x: 26, y: 5 },
    });
  });
});
