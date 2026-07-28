import * as vscode from "vscode";
import { ExtensionLifecycle, type UlwExtensionApi } from "./core/ExtensionLifecycle";

let lifecycle: ExtensionLifecycle | undefined;

export function activate(context: vscode.ExtensionContext): UlwExtensionApi {
  lifecycle = new ExtensionLifecycle();
  return lifecycle.activate(context);
}

export function deactivate(): void {
  lifecycle?.dispose();
  lifecycle = undefined;
}
