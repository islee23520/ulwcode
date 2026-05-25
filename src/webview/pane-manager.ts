import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITerminalAddon, type ITerminalOptions } from "@xterm/xterm";
import type { DroppedBlobFile } from "../types";
import { postMessage } from "./shared/vscode-api";

export interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  container: HTMLElement;
  disposed: boolean;
  rendererType: "webgl" | "canvas";
}

const DEFAULT_TERMINAL_OPTIONS: ITerminalOptions = {
  cursorBlink: true,
  cursorStyle: "block",
  fontSize: 14,
  fontFamily: "monospace",
  scrollback: 10000,
  theme: {
    background: "#1e1e1e",
    foreground: "#cccccc",
  },
};

class CanvasAddonFallback implements ITerminalAddon {
  activate(): void {}

  dispose(): void {}
}

export class PaneManager {
  private readonly instances = new Map<string, TerminalInstance>();

  private container: HTMLElement | null = null;

  private focusedPaneId: string | null = null;

  private webglCount = 0;

  init(container: HTMLElement): void {
    if (this.container) {
      return;
    }

    this.container = container;
    container.addEventListener("dragover", this.handleDragOver);
    container.addEventListener("drop", this.handleDrop);
  }

  createPane(
    paneId: string,
    container: HTMLElement,
    options: ITerminalOptions = {},
  ): TerminalInstance {
    this.disposePane(paneId);

    const terminal = new Terminal({
      ...DEFAULT_TERMINAL_OPTIONS,
      ...options,
      theme: {
        ...DEFAULT_TERMINAL_OPTIONS.theme,
        ...options.theme,
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);

    const rendererType = this.loadRendererAddon(terminal);

    terminal.open(container);

    const instance: TerminalInstance = {
      terminal,
      fitAddon,
      container,
      disposed: false,
      rendererType,
    };

    this.instances.set(paneId, instance);

    if (!this.focusedPaneId) {
      this.focusedPaneId = paneId;
    }

    return instance;
  }

  registerPane(
    paneId: string,
    terminal: Terminal | null,
    container: HTMLElement,
  ): void {
    if (terminal) {
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      this.instances.set(paneId, {
        terminal,
        fitAddon,
        container,
        disposed: false,
        rendererType: "webgl",
      });
    } else {
      this.createPane(paneId, container);
    }
  }

  disposePane(paneId: string): void {
    const instance = this.instances.get(paneId);
    if (!instance) {
      return;
    }

    instance.disposed = true;
    instance.terminal.dispose();

    if (instance.rendererType === "webgl") {
      this.webglCount = Math.max(0, this.webglCount - 1);
    }

    this.instances.delete(paneId);

    if (this.focusedPaneId === paneId) {
      this.focusedPaneId = this.getFirstPaneId();
    }
  }

  writeData(paneId: string, data: string): void {
    const instance = this.instances.get(paneId);
    if (!instance || instance.disposed) {
      return;
    }

    instance.terminal.write(data);
  }

  resizePane(paneId: string, cols: number, rows: number): void {
    const instance = this.instances.get(paneId);
    if (!instance || instance.disposed) {
      return;
    }

    instance.terminal.resize(cols, rows);
  }

  focusPane(paneId: string): void {
    const instance = this.instances.get(paneId);
    if (!instance || instance.disposed) {
      return;
    }

    this.focusedPaneId = paneId;
    instance.terminal.focus();
  }

  showPane(paneId: string): void {
    const instance = this.instances.get(paneId);
    if (!instance || instance.disposed) {
      return;
    }

    instance.container.style.display = "";
    instance.fitAddon.fit();
  }

  hidePane(paneId: string): void {
    const instance = this.instances.get(paneId);
    if (!instance || instance.disposed) {
      return;
    }

    instance.container.style.display = "none";
  }

  getPane(paneId: string): TerminalInstance | undefined {
    return this.instances.get(paneId);
  }

  getAllPaneIds(): string[] {
    return Array.from(this.instances.keys());
  }

  getPaneAtPoint(x: number, y: number): string | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    const element = document.elementFromPoint(x, y);
    const paneElement = element?.closest<HTMLElement>(".layout-pane[data-pane-id]");

    return paneElement?.dataset.paneId ?? null;
  }

  async handleDrop(event: DragEvent): Promise<void> {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const paneId = this.getPaneAtPoint(event.clientX, event.clientY) ?? this.focusedPaneId ?? this.getFirstPaneId();

    const files = await this.extractDroppedFiles(dataTransfer);
    if (files.length > 0) {
      postMessage({
        type: "filesDropped",
        files,
        shiftKey: event.shiftKey,
        paneId: paneId ?? undefined,
      });
      return;
    }

    const blobFiles = await this.readDroppedBlobFiles(dataTransfer.files);
    if (blobFiles.length > 0) {
      postMessage({
        type: "filesDropped",
        files: [],
        blobFiles,
        shiftKey: event.shiftKey,
        paneId: paneId ?? undefined,
      });
    }
  }

  dispose(): void {
    if (this.container) {
      this.container.removeEventListener("dragover", this.handleDragOver);
      this.container.removeEventListener("drop", this.handleDrop);
    }

    for (const paneId of this.getAllPaneIds()) {
      this.disposePane(paneId);
    }
    this.instances.clear();
    this.container = null;
    this.focusedPaneId = null;
    this.webglCount = 0;
  }

  private readonly handleDragOver = (event: DragEvent): void => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      return;
    }

    const hasFiles = Array.from(dataTransfer.types ?? []).some(
      (type) =>
        type === "Files" ||
        type === "text/uri-list" ||
        type.startsWith("application/vnd.code."),
    );

    if (!hasFiles) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  private loadRendererAddon(terminal: Terminal): "webgl" | "canvas" {
    if (this.webglCount < 4) {
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
        });
        terminal.loadAddon(webglAddon);
        this.webglCount += 1;
        return "webgl";
      } catch (error) {
        console.warn(
          "WebGL renderer not available, falling back to canvas:",
          error,
        );
      }
    }

    terminal.loadAddon(new CanvasAddonFallback());
    return "canvas";
  }

  private getFirstPaneId(): string | null {
    const first = this.instances.keys().next();
    return first.done ? null : first.value;
  }

  private async extractDroppedFiles(dataTransfer: DataTransfer): Promise<string[]> {
    const transferTypes = Array.from(dataTransfer.types ?? []);
    const transferItems = Array.from(dataTransfer.items ?? []);

    const files: string[] = [];
    const seen = new Set<string>();

    const addFile = (filePath: string | null | undefined): void => {
      const trimmed = filePath?.trim();
      if (!trimmed) {
        return;
      }

      const canonical = this.canonicalizeForDedup(trimmed);
      if (!canonical || seen.has(canonical)) {
        return;
      }

      seen.add(canonical);
      files.push(canonical);
    };

    const consumePayload = (payload: string): void => {
      if (!payload) {
        return;
      }

      for (const extracted of this.parseDroppedText(payload)) {
        addFile(extracted);
      }
    };

    for (const type of transferTypes) {
      try {
        consumePayload(dataTransfer.getData(type));
      } catch (error) {
        console.warn("[PaneManager] Failed to get data for type:", type, error);
      }
    }

    const stringPayloads = await Promise.all(
      transferItems
        .filter((item) => item.kind === "string")
        .map(
          (item) =>
            new Promise<string>((resolve) => {
              item.getAsString((value) => resolve(value ?? ""));
            }),
        ),
    );

    for (const payload of stringPayloads) {
      consumePayload(payload);
    }

    return files;
  }

  private async readDroppedBlobFiles(files: FileList): Promise<DroppedBlobFile[]> {
    if (files.length === 0) {
      return [];
    }

    return Promise.all(
      Array.from(files).map(async (file) => ({
        name: file.name,
        data: await this.readFileAsDataUrl(file),
      })),
    );
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("FileReader produced a non-string result"));
      };
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.onabort = () => reject(new Error("FileReader aborted"));
      reader.readAsDataURL(file);
    });
  }

  private canonicalizeForDedup(p: string): string {
    let s = p.trim();
    s = s.replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(s)) {
      s = s[0].toLowerCase() + s.slice(1);
    }
    if (s.length > 1) {
      s = s.replace(/\/$/, "");
    }
    return s;
  }

  private parseDroppedText(payload: string): string[] {
    const paths: string[] = [];
    const lines = payload
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      const filePath = this.extractFilePathFromValue(line);
      if (filePath) {
        paths.push(filePath);
      }
    }

    if (paths.length > 0) {
      return paths;
    }

    try {
      const parsed = JSON.parse(payload) as unknown;
      const stack: unknown[] = [parsed];

      while (stack.length > 0) {
        const current = stack.pop();

        if (typeof current === "string") {
          const filePath = this.extractFilePathFromValue(current);
          if (filePath) {
            paths.push(filePath);
          }
          continue;
        }

        if (Array.isArray(current)) {
          stack.push(...current);
          continue;
        }

        if (current && typeof current === "object") {
          stack.push(...Object.values(current as Record<string, unknown>));
        }
      }
    } catch (error) {
      console.warn("[PaneManager] Failed to parse dropped text payload:", error);
    }

    return paths;
  }

  private extractFilePathFromValue(value: string): string | null {
    const candidate = value.trim();

    if (!candidate || candidate.startsWith("#")) {
      return null;
    }

    try {
      const url = new URL(candidate);

      if (url.protocol === "file:" || url.protocol === "vscode-file:") {
        const decodedPath = decodeURIComponent(url.pathname);
        const hasWindowsDrivePrefix =
          decodedPath.length >= 3 &&
          decodedPath[0] === "/" &&
          /[A-Za-z]/.test(decodedPath[1] ?? "") &&
          decodedPath[2] === ":";

        return hasWindowsDrivePrefix ? decodedPath.slice(1) : decodedPath;
      }
    } catch (error) {
      console.warn('[PaneManager] URI decode failed for drag/drop path:', error);
      const hasWindowsDrivePath =
        candidate.length >= 3 &&
        /[A-Za-z]/.test(candidate[0] ?? "") &&
        candidate[1] === ":" &&
        (candidate[2] === "\\" || candidate[2] === "/");

      if (candidate.startsWith("/") || hasWindowsDrivePath) {
        return candidate;
      }
    }

    return null;
  }
}
