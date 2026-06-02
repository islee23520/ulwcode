import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE } from "../../types";
import { postMessage } from "../shared/vscode-api";

function postTriggerPaste(): void {
  postMessage({ type: "triggerPaste" });
}

function postImageFromBlob(blob: Blob): void {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      postMessage({
        type: "imagePasted",
        data: reader.result,
      });
    }
  };
  reader.onerror = () => {
    console.error("FileReader failed to read image");
    postTriggerPaste();
  };
  reader.onabort = () => {
    postTriggerPaste();
  };
  reader.readAsDataURL(blob);
}

export function handlePasteEventWithImageSupport(
  event: ClipboardEvent,
): boolean {
  const items = Array.from(event.clipboardData?.items ?? []);
  const imageItem = items.find((item) => ALLOWED_IMAGE_TYPES.includes(item.type));
  if (!imageItem) {
    return false;
  }

  const blob = imageItem.getAsFile();
  if (!blob) {
    return false;
  }

  if (blob.size > MAX_IMAGE_SIZE) {
    console.warn("Image too large, falling back to text paste");
    return false;
  }

  postImageFromBlob(blob);
  return true;
}

export async function handlePasteWithImageSupport(): Promise<void> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => ALLOWED_IMAGE_TYPES.includes(t));
      if (imageType) {
        const blob = await item.getType(imageType);
        if (blob.size > MAX_IMAGE_SIZE) {
          console.warn("Image too large, falling back to text paste");
          break;
        }
        postImageFromBlob(blob);
        return;
      }
    }
  } catch (err) {
    console.warn(
      "Could not read image from clipboard, falling back to text paste:",
      err,
    );
  }
  postTriggerPaste();
}

export function copySelectionToClipboard(selection: string): void {
  postMessage({
    type: "setClipboard",
    text: selection,
  });
}

export function copyOsc52ToClipboard(data: string): boolean {
  const payloadSeparator = data.indexOf(";");
  if (payloadSeparator === -1) {
    return false;
  }

  const payload = data.slice(payloadSeparator + 1).replace(/\s/g, "");
  if (!payload || payload === "?") {
    return false;
  }

  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const text = new TextDecoder().decode(bytes);
    if (!text) {
      return false;
    }

    copySelectionToClipboard(text);
    return true;
  } catch {
    return false;
  }
}
