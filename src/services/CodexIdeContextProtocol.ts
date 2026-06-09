import * as net from "node:net";
import type { ILogger } from "./ILogger";

export interface CodexIdeContextServiceOptions {
  readonly socketPath?: string;
}

export interface CodexPosition {
  readonly line: number;
  readonly character: number;
}

export interface CodexRange {
  readonly start: CodexPosition;
  readonly end: CodexPosition;
}

export interface CodexFileDescriptor {
  readonly label: string;
  readonly path: string;
}

export interface CodexActiveFile extends CodexFileDescriptor {
  readonly selection: CodexRange;
  readonly activeSelectionContent: string;
  readonly selections: readonly CodexRange[];
}

export interface CodexIdeContext {
  readonly activeFile: CodexActiveFile | null;
  readonly openTabs: readonly CodexFileDescriptor[];
}

export type CodexIpcMessage = Record<string, unknown>;

export function writeCodexIpcFrame(
  socket: net.Socket,
  message: CodexIpcMessage,
): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  socket.write(Buffer.concat([header, payload]));
}

export function drainCodexIpcFrames(
  input: Buffer<ArrayBufferLike>,
  onFrame: (payload: Buffer) => void,
): Buffer<ArrayBufferLike> {
  let offset = 0;
  while (input.length - offset >= 4) {
    const payloadLength = input.readUInt32LE(offset);
    if (input.length - offset - 4 < payloadLength) {
      break;
    }

    const payloadStart = offset + 4;
    const payload = input.subarray(payloadStart, payloadStart + payloadLength);
    offset = payloadStart + payloadLength;
    onFrame(payload);
  }

  return input.subarray(offset);
}

export function parseCodexIpcMessage(
  payload: Buffer,
  logger?: ILogger,
): CodexIpcMessage | undefined {
  try {
    const parsed: unknown = JSON.parse(payload.toString("utf8"));
    return isObjectRecord(parsed) ? parsed : undefined;
  } catch (error) {
    logger?.warn(
      `[CodexIdeContextService] Failed to parse IDE context frame: ${formatUnknownError(error)}`,
    );
    return undefined;
  }
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function objectValue(
  value: unknown,
): Record<string, unknown> | undefined {
  return isObjectRecord(value) ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
