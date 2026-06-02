// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyOsc52ToClipboard,
  copySelectionToClipboard,
  handlePasteEventWithImageSupport,
} from "./index";

const mockPostMessage = vi.hoisted(() => vi.fn());

vi.mock("../shared/vscode-api", () => ({
  postMessage: mockPostMessage,
}));

class MockFileReader {
  public result: string | ArrayBuffer | null = null;
  public onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
  public onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
  public onabort: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

  public readAsDataURL(_blob: Blob): void {
    this.result = "data:image/png;base64,ZmFrZQ==";
    this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
  }
}

describe("clipboard helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("FileReader", MockFileReader);
  });

  it("passes terminal selections to the host clipboard bridge", () => {
    copySelectionToClipboard("selected text");

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "setClipboard",
      text: "selected text",
    });
  });

  it("passes OSC52 clipboard payloads to the host clipboard bridge", () => {
    const payload = btoa("remote copied text");

    expect(copyOsc52ToClipboard(`c;${payload}`)).toBe(true);

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "setClipboard",
      text: "remote copied text",
    });
  });

  it("ignores invalid OSC52 clipboard payloads", () => {
    expect(copyOsc52ToClipboard("c;not-base64!")).toBe(false);
    expect(copyOsc52ToClipboard("c;?")).toBe(false);

    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("does not intercept plain-text paste events", () => {
    const event = {
      clipboardData: {
        items: [
          {
            type: "text/plain",
            getAsFile: () => null,
          },
        ],
      },
    } as unknown as ClipboardEvent;

    expect(handlePasteEventWithImageSupport(event)).toBe(false);
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("intercepts image paste events and forwards image data", () => {
    const blob = new Blob(["fake"], { type: "image/png" });
    const event = {
      clipboardData: {
        items: [
          {
            type: "image/png",
            getAsFile: () => blob,
          },
        ],
      },
    } as unknown as ClipboardEvent;

    expect(handlePasteEventWithImageSupport(event)).toBe(true);
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "imagePasted",
      data: "data:image/png;base64,ZmFrZQ==",
    });
  });
});
