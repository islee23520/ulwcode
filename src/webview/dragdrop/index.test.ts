import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleDrop } from "./index";
import { postMessage } from "../shared/vscode-api";

vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
}));

describe("handleDrop", () => {
  const originalFileReader = globalThis.FileReader;

  beforeEach(() => {
    vi.clearAllMocks();

    class MockFileReader {
      public result: string | ArrayBuffer | null = null;
      public onload:
        | ((this: FileReader, ev: ProgressEvent<FileReader>) => any)
        | null = null;
      public onerror:
        | ((this: FileReader, ev: ProgressEvent<FileReader>) => any)
        | null = null;
      public onabort:
        | ((this: FileReader, ev: ProgressEvent<FileReader>) => any)
        | null = null;

      public readAsDataURL(file: File): void {
        this.result = `data:${file.type || "application/octet-stream"};base64,SGVsbG8=`;
        this.onload?.call(
          this as unknown as FileReader,
          {} as ProgressEvent<FileReader>,
        );
      }
    }

    Object.defineProperty(globalThis, "FileReader", {
      configurable: true,
      value: MockFileReader,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "FileReader", {
      configurable: true,
      value: originalFileReader,
    });
  });

  it("posts real file paths when URI payloads are available", async () => {
    await handleDrop(
      {
        dataTransfer: {
          types: ["text/uri-list"],
          items: [],
          files: [],
          getData: (type: string) =>
            type === "text/uri-list" ? "file:///workspace/src/index.ts" : "",
        },
        shiftKey: false,
        clientX: 0,
        clientY: 0,
      } as unknown as DragEvent,
      {
        getTerminalCols: () => 80,
        getTerminalRows: () => 24,
        getScreenElement: () => null,
      },
    );

    expect(postMessage).toHaveBeenCalledWith({
      type: "filesDropped",
      files: ["/workspace/src/index.ts"],
      shiftKey: false,
      dropCell: undefined,
    });
  });

  it("posts every file path from multi-file URI payloads", async () => {
    await handleDrop(
      {
        dataTransfer: {
          types: ["text/uri-list"],
          items: [],
          files: [],
          getData: (type: string) =>
            type === "text/uri-list"
              ? "file:///workspace/src/a.ts\nfile:///workspace/src/b.ts"
              : "",
        },
        shiftKey: false,
        clientX: 0,
        clientY: 0,
      } as unknown as DragEvent,
      {
        getTerminalCols: () => 80,
        getTerminalRows: () => 24,
        getScreenElement: () => null,
      },
    );

    expect(postMessage).toHaveBeenCalledWith({
      type: "filesDropped",
      files: ["/workspace/src/a.ts", "/workspace/src/b.ts"],
      shiftKey: false,
      dropCell: undefined,
    });
  });

  it("posts VS Code Explorer plain text file payloads", async () => {
    await handleDrop(
      {
        dataTransfer: {
          types: ["text/plain"],
          items: [],
          files: [],
          getData: (type: string) =>
            type === "text/plain" ? "/workspace/src/from-explorer.ts" : "",
        },
        shiftKey: false,
        clientX: 0,
        clientY: 0,
      } as unknown as DragEvent,
      {
        getTerminalCols: () => 80,
        getTerminalRows: () => 24,
        getScreenElement: () => null,
      },
    );

    expect(postMessage).toHaveBeenCalledWith({
      type: "filesDropped",
      files: ["/workspace/src/from-explorer.ts"],
      shiftKey: false,
      dropCell: undefined,
    });
  });

  it("falls back to blobFiles when only dropped File objects are available", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    await handleDrop(
      {
        dataTransfer: {
          types: ["Files"],
          items: [],
          files: [file],
          getData: () => "",
        },
        shiftKey: false,
        clientX: 0,
        clientY: 0,
      } as unknown as DragEvent,
      {
        getTerminalCols: () => 80,
        getTerminalRows: () => 24,
        getScreenElement: () => null,
      },
    );

    expect(postMessage).toHaveBeenCalledWith({
      type: "filesDropped",
      files: [],
      blobFiles: [
        {
          name: "notes.txt",
          data: "data:text/plain;base64,SGVsbG8=",
        },
      ],
      shiftKey: false,
      dropCell: undefined,
    });
  });

  it("uses non-standard Electron file paths before blob fallback", async () => {
    const first = new File(["a"], "a.ts", { type: "text/plain" });
    const second = new File(["b"], "b.ts", { type: "text/plain" });
    Object.defineProperty(first, "path", {
      configurable: true,
      value: "/workspace/src/a.ts",
    });
    Object.defineProperty(second, "path", {
      configurable: true,
      value: "/workspace/src/b.ts",
    });

    await handleDrop(
      {
        dataTransfer: {
          types: ["Files"],
          items: [],
          files: [first, second],
          getData: () => "",
        },
        shiftKey: false,
        clientX: 0,
        clientY: 0,
      } as unknown as DragEvent,
      {
        getTerminalCols: () => 80,
        getTerminalRows: () => 24,
        getScreenElement: () => null,
      },
    );

    expect(postMessage).toHaveBeenCalledWith({
      type: "filesDropped",
      files: ["/workspace/src/a.ts", "/workspace/src/b.ts"],
      shiftKey: false,
      dropCell: undefined,
    });
  });
});
