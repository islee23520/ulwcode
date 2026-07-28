import type { WebviewMessage } from "../../types";

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

export function postMessage(message: WebviewMessage): void {
  api ??= acquireVsCodeApi();
  api.postMessage(message);
}
