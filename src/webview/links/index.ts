import { postMessage } from "../shared/vscode-api";

interface Link {
  text: string;
  range: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  activate: () => void;
}

interface LinkTerminal {
  buffer: {
    active: {
      getLine: (lineNumber: number) =>
        | {
            translateToString: (trimRight?: boolean) => string;
          }
        | undefined;
    };
  };
}

const MAX_LINE_LENGTH = 10000;

const FILE_NAME_PATTERN =
  "[A-Za-z0-9_.-]+\\.(?:c|cc|cpp|cs|css|cts|env|fish|go|h|hpp|html|java|js|json|jsx|kt|lock|lua|md|mjs|mts|php|py|rb|rs|scss|sh|swift|toml|ts|tsx|txt|yaml|yml|zsh)";

const PATH_REGEX =
  new RegExp(
    `(^|[\\s"'\\\`([{<])(@?((?:(?:file:\\/\\/|\\/|[A-Za-z]:\\\\|\\.?\\.?\\/)[^\\s"'#:]+|[^\\s":\\/]+(?:\\/[^\\s":\\/]+)+|${FILE_NAME_PATTERN}))(?::(\\d+)(?::(\\d+))?)?(?:#L(\\d+)(?:-L?(\\d+))?)?)(?=[\\s"'\\\`\\])}>]|$)`,
    "gi",
  );

export function createLinkProvider(terminal: LinkTerminal) {
  return {
    provideLinks(
      bufferLineNumber: number,
      callback: (links: Link[] | undefined) => void,
    ) {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const lineText = line.translateToString(true);

      if (lineText.length > MAX_LINE_LENGTH) {
        callback(undefined);
        return;
      }

      const links: Link[] = [];
      PATH_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null = PATH_REGEX.exec(lineText);
      let lastIndex = -1;

      while (match) {
        if (match.index === lastIndex) {
          PATH_REGEX.lastIndex++;
          match = PATH_REGEX.exec(lineText);
          continue;
        }
        lastIndex = match.index;

        const fullMatch = match[2];
        const hasAtPrefix = fullMatch.startsWith("@");
        let path = match[3];
        const suffixLineStr = match[4];
        const suffixColumnStr = match[5];
        const anchorLineStr = match[6];
        const endLineStr = match[7];

        if (!path) continue;

        let lineNumber: number | undefined;
        let columnNumber: number | undefined;
        let endLineNumber: number | undefined;

        if (path.startsWith("file://")) {
          try {
            const url = new URL(path);
            path = decodeURIComponent(url.pathname);
            if (url.hostname && !url.pathname.startsWith("/")) {
              path = `${url.hostname}:${path}`;
            }
          } catch {
            continue;
          }
        }

        if (suffixLineStr) {
          lineNumber = parseInt(suffixLineStr, 10);
        }
        if (suffixColumnStr) {
          columnNumber = parseInt(suffixColumnStr, 10);
        }
        if (anchorLineStr) {
          lineNumber = parseInt(anchorLineStr, 10);
        }
        if (endLineStr) {
          endLineNumber = parseInt(endLineStr, 10);
        }

        const index = match.index + match[1].length;
        const linkText = hasAtPrefix ? `@${path}` : path;

        links.push({
          text: linkText,
          range: {
            start: { x: index + 1, y: bufferLineNumber },
            end: { x: index + linkText.length, y: bufferLineNumber },
          },
          activate: () => {
            postMessage({
              type: "openFile",
              path: path,
              line: lineNumber,
              endLine: endLineNumber,
              column: columnNumber,
            });
          },
        });

        match = PATH_REGEX.exec(lineText);
      }

      callback(links);
    },
  };
}
