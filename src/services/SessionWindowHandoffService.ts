import * as vscode from "vscode";

export interface SessionWindowHandoff {
  id: string;
  workspaceUri: string;
  sessionId: string;
  backend: "tmux" | "zellij";
  label?: string;
  createdAt: number;
}

export class SessionWindowHandoffService {
  private static readonly STORAGE_KEY =
    "opencodeTui.pendingSessionWindowHandoffs";
  private static readonly HANDOFF_TTL_MS = 2 * 60 * 1000; // 2 minutes

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Write a pending handoff and return the handoff ID.
   * Prunes expired handoffs before writing.
   */
  async writeHandoff(
    payload: Omit<SessionWindowHandoff, "id" | "createdAt">,
  ): Promise<string> {
    await this.pruneExpired();

    const handoffs = this.context.globalState.get<SessionWindowHandoff[]>(
      SessionWindowHandoffService.STORAGE_KEY,
      [],
    );
    const handoff: SessionWindowHandoff = {
      ...payload,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };

    handoffs.push(handoff);
    await this.context.globalState.update(
      SessionWindowHandoffService.STORAGE_KEY,
      handoffs,
    );

    return handoff.id;
  }

  /**
   * Consume (read + remove) a pending handoff matching the current workspace URI.
   * Returns the most recent matching handoff, or undefined if none found.
   * Prunes expired handoffs before searching.
   */
  async consumeHandoff(
    currentWorkspaceUri: string,
  ): Promise<SessionWindowHandoff | undefined> {
    await this.pruneExpired();

    const handoffs = this.context.globalState.get<SessionWindowHandoff[]>(
      SessionWindowHandoffService.STORAGE_KEY,
      [],
    );
    const matchingHandoff = handoffs
      .filter((handoff) => handoff.workspaceUri === currentWorkspaceUri)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (!matchingHandoff) {
      return undefined;
    }

    await this.context.globalState.update(
      SessionWindowHandoffService.STORAGE_KEY,
      handoffs.filter((handoff) => handoff.id !== matchingHandoff.id),
    );

    return matchingHandoff;
  }

  /**
   * Remove all pending handoffs (for cleanup/dispose).
   */
  async clearAll(): Promise<void> {
    await this.context.globalState.update(
      SessionWindowHandoffService.STORAGE_KEY,
      [],
    );
  }

  /**
   * Prune expired handoffs from storage. Called internally on every read/write.
   */
  private async pruneExpired(): Promise<void> {
    const now = Date.now();
    const handoffs = this.context.globalState.get<SessionWindowHandoff[]>(
      SessionWindowHandoffService.STORAGE_KEY,
      [],
    );
    const activeHandoffs = handoffs.filter(
      (handoff) =>
        now - handoff.createdAt <= SessionWindowHandoffService.HANDOFF_TTL_MS,
    );

    await this.context.globalState.update(
      SessionWindowHandoffService.STORAGE_KEY,
      activeHandoffs,
    );
  }
}
