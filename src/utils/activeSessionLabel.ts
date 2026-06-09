import type { HostMessage, TerminalBackendType } from "../types";

export function formatActiveSessionLabel(
  message: Extract<HostMessage, { type: "activeSession" }>,
  backend: TerminalBackendType,
): string {
  if (!("sessionName" in message) || !message.sessionName) {
    return "shell";
  }

  const backendPrefix = backend === "zellij" ? "Z" : "T";
  const windowSuffix =
    message.windowIndex !== undefined
      ? ` #${message.windowIndex}${message.windowName ? ` ${message.windowName}` : ""}`
      : "";
  return `${backendPrefix}:${message.sessionName}${windowSuffix}`;
}
