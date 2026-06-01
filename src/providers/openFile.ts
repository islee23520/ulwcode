import * as vscode from "vscode";
import { isWindowsAbsolutePath } from "../utils/pathUtils";

type FileLocation = {
  readonly line?: number;
  readonly endLine?: number;
  readonly column?: number;
};

type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

const URI_SCHEME_REGEX = /^[a-z][a-z0-9+\-.]*:\/\//i;
const MAX_COLUMN = 9999;

const isPositiveInteger = (value: number | undefined): boolean =>
  value === undefined || (Number.isInteger(value) && value > 0);

const validateLocation = (location: FileLocation): ValidationResult => {
  if (
    !isPositiveInteger(location.line) ||
    !isPositiveInteger(location.endLine) ||
    !isPositiveInteger(location.column)
  ) {
    return {
      ok: false,
      message: "Invalid file location: line and column must be positive integers",
    };
  }

  if (location.endLine !== undefined && location.line === undefined) {
    return {
      ok: false,
      message: "Invalid file location: endLine requires line",
    };
  }

  if (
    location.line !== undefined &&
    location.endLine !== undefined &&
    location.endLine < location.line
  ) {
    return {
      ok: false,
      message: "Invalid file location: endLine must be greater than line",
    };
  }

  return { ok: true };
};

const validateFilePath = (filePath: string): ValidationResult => {
  if (
    filePath.includes("..") ||
    filePath.includes("\0") ||
    filePath.includes("~")
  ) {
    return {
      ok: false,
      message: "Invalid file path: Path traversal detected",
    };
  }

  if (URI_SCHEME_REGEX.test(filePath)) {
    try {
      if (new URL(filePath).protocol !== "file:") {
        return {
          ok: false,
          message: "Invalid file path: Only file URIs can be opened",
        };
      }
    } catch {
      return {
        ok: false,
        message: "Invalid file path: Malformed URI",
      };
    }
  }

  return { ok: true };
};

export function createSelection(
  line?: number,
  endLine?: number,
  column?: number,
): vscode.Range | undefined {
  if (line === undefined) {
    return undefined;
  }

  const startLine = line - 1;
  const startColumn = (column ?? 1) - 1;
  const endSelectionLine = (endLine ?? line) - 1;
  const endColumn = endLine === undefined ? startColumn : MAX_COLUMN;

  return new vscode.Range(startLine, startColumn, endSelectionLine, endColumn);
}

export async function fuzzyMatchFile(
  filePath: string,
  onError?: (message: string) => void,
): Promise<vscode.Uri | null> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    const pathParts = filePath
      .split(/[\\/]/)
      .filter((part) => part.length > 0);
    const filename = pathParts[pathParts.length - 1];

    const pattern = `**/${filename}*`;
    const files = await vscode.workspace.findFiles(pattern, null, 100);

    const normalizedInput = filePath.replace(/\\/g, "/").toLowerCase();
    files.sort((a, b) => {
      const aPath = a.fsPath.replace(/\\/g, "/").toLowerCase();
      const bPath = b.fsPath.replace(/\\/g, "/").toLowerCase();

      if (aPath.endsWith(normalizedInput)) {
        return -1;
      }
      if (bPath.endsWith(normalizedInput)) {
        return 1;
      }

      const aDirParts = a.fsPath.split(/[\\/]/);
      const bDirParts = b.fsPath.split(/[\\/]/);

      for (let i = 0; i < pathParts.length - 1; i++) {
        const expectedPart = pathParts[i]?.toLowerCase();
        if (aDirParts[i]?.toLowerCase() === expectedPart) {
          return -1;
        }
        if (bDirParts[i]?.toLowerCase() === expectedPart) {
          return 1;
        }
      }

      return 0;
    });

    return files[0] ?? null;
  } catch (error) {
    onError?.(
      `Fuzzy match failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function openFileInEditor(
  filePath: string,
  line?: number,
  endLine?: number,
  column?: number,
  onFuzzyMatchError?: (message: string) => void,
): Promise<void> {
  const pathValidation = validateFilePath(filePath);
  if (!pathValidation.ok) {
    void vscode.window.showErrorMessage(pathValidation.message);
    return;
  }

  const locationValidation = validateLocation({ line, endLine, column });
  if (!locationValidation.ok) {
    void vscode.window.showErrorMessage(locationValidation.message);
    return;
  }

  try {
    const normalizedPath = filePath.replace(/\\/g, "/");
    let uri: vscode.Uri;

    if (URI_SCHEME_REGEX.test(filePath)) {
      const parsedUrl = new URL(filePath);
      uri = vscode.Uri.file(decodeURIComponent(parsedUrl.pathname));
    } else if (
      normalizedPath.startsWith("/") ||
      isWindowsAbsolutePath(filePath)
    ) {
      uri = vscode.Uri.file(filePath);
    } else {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        uri = vscode.Uri.joinPath(workspaceFolders[0].uri, normalizedPath);
      } else {
        uri = vscode.Uri.file(normalizedPath);
      }
    }

    try {
      const selection = createSelection(line, endLine, column);

      await vscode.window.showTextDocument(uri, {
        selection,
        preview: true,
      });
    } catch {
      const matchedUri = await fuzzyMatchFile(normalizedPath, onFuzzyMatchError);
      if (matchedUri) {
        const selection = createSelection(line, endLine, column);

        await vscode.window.showTextDocument(matchedUri, {
          selection,
          preview: true,
        });
      } else {
        void vscode.window.showErrorMessage(
          `Failed to open file: ${filePath}`,
        );
      }
    }
  } catch {
    void vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
  }
}
