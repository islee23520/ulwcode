/**
 * Main entry point for the ULW VS Code extension.
 */

import * as vscode from "vscode";
import { ExtensionLifecycle } from "./core/ExtensionLifecycle";
import { OutputChannelService } from "./services/OutputChannelService";

const lifecycle = new ExtensionLifecycle();

export function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = OutputChannelService.getInstance();
  logger.info("ULW extension activating...");
  return lifecycle.activate(context);
}

export async function deactivate(): Promise<void> {
  const logger = OutputChannelService.getInstance();
  logger.info("ULW extension deactivating...");
  await lifecycle.deactivate();
}
