import * as vscode from "vscode";
import { OutputChannelService } from "./OutputChannelService";
import { FileReferenceManager } from "./FileReferenceManager";

export class ContextManager implements vscode.Disposable {
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly outputChannel: OutputChannelService;
  private readonly diagnostics: Map<string, vscode.Diagnostic[]> = new Map();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly debounceMs: number;

  private activeEditor: vscode.TextEditor | undefined;
  private activeSelection: vscode.Selection | undefined;

  constructor(
    outputChannel: OutputChannelService,
    private readonly fileRefManager?: FileReferenceManager,
  ) {
    this.outputChannel = outputChannel;

    const config = vscode.workspace.getConfiguration("ulw");
    this.debounceMs = config.get<number>("contextDebounceMs", 500);

    this.activeEditor = vscode.window.activeTextEditor;
    this.activeSelection = this.activeEditor?.selection;

    this.setupEventListeners();

    if (this.fileRefManager) {
      this.setupFileReferenceListeners();
    }
    this.outputChannel.info(
      `ContextManager initialized (debounce: ${this.debounceMs}ms)`,
    );
  }

  private setupEventListeners(): void {
    const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        this.activeEditor = editor;
        this.activeSelection = editor?.selection;
        this.handleContextChange();
      },
    );

    const selectionDisposable = vscode.window.onDidChangeTextEditorSelection(
      (event) => {
        this.activeEditor = event.textEditor;
        this.activeSelection = event.textEditor.selection;
        this.handleContextChange();
      },
    );

    const documentDisposable = vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (
          this.activeEditor &&
          this.getUriKey(this.activeEditor.document.uri) ===
            this.getUriKey(event.document.uri)
        ) {
          this.handleContextChange();
        }
      },
    );

    const diagnosticsDisposable = vscode.languages.onDidChangeDiagnostics(
      (event) => {
        event.uris.forEach((uri) => {
          this.diagnostics.set(
            this.getUriKey(uri),
            vscode.languages.getDiagnostics(uri),
          );
        });
        this.outputChannel.debug(
          `Diagnostics updated for ${event.uris.length} file(s)`,
        );
      },
    );

    this.disposables.push(
      activeEditorDisposable,
      selectionDisposable,
      documentDisposable,
      diagnosticsDisposable,
    );
  }

  private setupFileReferenceListeners(): void {
    this.disposables.push(
      this.fileRefManager!.onDidAddReference((ref) => {
        this.outputChannel.info(`File reference added: ${ref.path}`);
      }),
      this.fileRefManager!.onDidRemoveReference((id) => {
        this.outputChannel.info(`File reference removed: ${id}`);
      }),
      this.fileRefManager!.onDidClearReferences(() => {
        this.outputChannel.info("All file references cleared");
      }),
    );
  }

  private handleContextChange(): void {
    this.debouncedUpdate();
  }

  private debouncedUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      const filePath = this.activeEditor?.document.uri.fsPath ?? "none";
      const selectionText = this.activeSelection
        ? `L${this.activeSelection.start.line + 1}-L${this.activeSelection.end.line + 1}`
        : "none";

      this.outputChannel.debug(
        `Context updated (file: ${filePath}, selection: ${selectionText})`,
      );
    }, this.debounceMs);
  }

  public getDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
    return this.diagnostics.get(this.getUriKey(uri)) ?? [];
  }

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;

    this.outputChannel.info("ContextManager disposed");
  }

  private getUriKey(uri: vscode.Uri): string {
    return uri.fsPath || uri.path || uri.toString();
  }
}
