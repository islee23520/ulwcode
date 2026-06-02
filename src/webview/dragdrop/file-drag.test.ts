import { describe, expect, it } from "vitest";

import { hasFileDragPayload } from "./file-drag";

describe("hasFileDragPayload", () => {
  it("accepts macOS Finder file URL drag types", () => {
    expect(hasFileDragPayload(["public.file-url"])).toBe(true);
    expect(hasFileDragPayload(["NSFilenamesPboardType"])).toBe(true);
    expect(hasFileDragPayload(["com.apple.finder.node"])).toBe(true);
  });

  it("accepts file item drags even when transfer types are missing", () => {
    expect(
      hasFileDragPayload([], {
        0: { kind: "file" },
        length: 1,
      }),
    ).toBe(true);
  });

  it("accepts VS Code Explorer drags that only expose plain text during dragover", () => {
    expect(hasFileDragPayload(["text/plain"], [{ kind: "string" }])).toBe(
      true,
    );
  });

  it("rejects non-file rich text drags without file evidence", () => {
    expect(hasFileDragPayload(["text/html"], [{ kind: "string" }])).toBe(
      false,
    );
  });
});
