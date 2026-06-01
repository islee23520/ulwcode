import type { Terminal } from "@xterm/xterm";
import { postMessage } from "../shared/vscode-api";

interface Link {
  text: string;
  range: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  activate: () => void;
}

const MAX_LINE_LENGTH = 10000;

type ParsedFileReference = {
  readonly path: string;
  readonly line?: number;
  readonly endLine?: number;
  readonly column?: number;
};

type CandidateReference = {
  readonly text: string;
  readonly startIndex: number;
};

const isTokenBoundary = (char: string): boolean =>
  /\s/.test(char) || char === "\"" || char === "'";

const collectCandidateReferences = (
  lineText: string,
): ReadonlyArray<CandidateReference> => {
  const candidates: CandidateReference[] = [];
  let index = 0;

  while (index < lineText.length) {
    while (index < lineText.length && isTokenBoundary(lineText[index] ?? "")) {
      index++;
    }

    const startIndex = index;
    while (index < lineText.length && !isTokenBoundary(lineText[index] ?? "")) {
      index++;
    }

    if (index > startIndex) {
      candidates.push({
        text: lineText.slice(startIndex, index),
        startIndex,
      });
    }
  }

  return candidates;
};

const isLikelyFileReference = (candidate: string): boolean => {
  const withoutAtPrefix = candidate.startsWith("@")
    ? candidate.slice(1)
    : candidate;

  return (
    withoutAtPrefix.startsWith("file://") ||
    withoutAtPrefix.startsWith("/") ||
    withoutAtPrefix.startsWith("./") ||
    withoutAtPrefix.startsWith("../") ||
    /^[A-Za-z]:\\/.test(withoutAtPrefix) ||
    (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(withoutAtPrefix) &&
      withoutAtPrefix.includes("/"))
  );
};

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const extractHashLineSuffix = (
  reference: string,
): { readonly reference: string; readonly line?: number; readonly endLine?: number } => {
  const match = /^(.*)#L(\d+)(?:-L?(\d+))?$/.exec(reference);
  if (!match) {
    return { reference };
  }

  return {
    reference: match[1] ?? reference,
    line: parsePositiveInteger(match[2]),
    endLine: parsePositiveInteger(match[3]),
  };
};

const extractColonSuffix = (
  reference: string,
): { readonly reference: string; readonly line?: number; readonly column?: number } => {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(reference);
  if (!match) {
    return { reference };
  }

  return {
    reference: match[1] ?? reference,
    line: parsePositiveInteger(match[2]),
    column: parsePositiveInteger(match[3]),
  };
};

const parseFileReference = (candidate: string): ParsedFileReference | null => {
  const withoutAtPrefix = candidate.startsWith("@")
    ? candidate.slice(1)
    : candidate;
  const hashSuffix = extractHashLineSuffix(withoutAtPrefix);
  const colonSuffix = extractColonSuffix(hashSuffix.reference);
  let path = colonSuffix.reference;

  if (!path) {
    return null;
  }

  if (path.startsWith("file://")) {
    try {
      const url = new URL(path);
      path = decodeURIComponent(url.pathname);
      if (url.hostname && !url.pathname.startsWith("/")) {
        path = `${url.hostname}:${path}`;
      }
    } catch {
      return null;
    }
  }

  return {
    path,
    line: hashSuffix.line ?? colonSuffix.line,
    endLine: hashSuffix.endLine,
    column: colonSuffix.column,
  };
};

export function createLinkProvider(terminal: Terminal) {
  return {
    provideLinks(
      bufferLineNumber: number,
      callback: (links: Link[] | undefined) => void,
    ) {
      const line = terminal.buffer.active.getLine(bufferLineNumber);
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

      for (const candidate of collectCandidateReferences(lineText)) {
        if (!isLikelyFileReference(candidate.text)) continue;

        const parsedReference = parseFileReference(candidate.text);
        if (!parsedReference) continue;

        links.push({
          text: candidate.text,
          range: {
            start: { x: candidate.startIndex + 1, y: bufferLineNumber },
            end: {
              x: candidate.startIndex + candidate.text.length,
              y: bufferLineNumber,
            },
          },
          activate: () => {
            postMessage({
              type: "openFile",
              path: parsedReference.path,
              line: parsedReference.line,
              endLine: parsedReference.endLine,
              column: parsedReference.column,
            });
          },
        });
      }

      callback(links);
    },
  };
}
