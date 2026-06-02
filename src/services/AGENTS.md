# SERVICES KNOWLEDGE BASE

## OVERVIEW

Stateful backend layer for instances, terminal backends, HTTP clients, context/file references, tmux/zellij integration, and logging.

## WHERE TO LOOK

| Task                  | Location                                                                   | Notes                                                                         |
| --------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Instance state hub    | `InstanceStore.ts`                                                         | active instance, immutable clones, `change`/`setActive`/`add`/`remove` events |
| Instance persistence  | `InstanceRegistry.ts`                                                      | `globalState`/`workspaceState`, migrations                                    |
| Spawn/connect/kill    | `InstanceController.ts`                                                    | user actions, terminal manager, port manager                                  |
| Discovery             | `InstanceDiscoveryService.ts`                                              | process scan, auto-spawn, store sync                                          |
| Connection resolution | `ConnectionResolver.ts`                                                    | stored -> discovered -> spawned, client pooling                               |
| HTTP API              | `OpenCodeApiClient.ts`                                                     | `/health`, `/tui/append-prompt`, retry/backoff                                |
| Port allocation       | `PortManager.ts`                                                           | exported `portManager`, range 16384-65535                                     |
| Native terminal       | `NativeTerminalManager.ts`                                                 | VS Code terminal backend                                                      |
| PTY terminal          | `../terminals/TerminalManager.ts`                                          | node-pty backend                                                              |
| Tmux                  | `TmuxSessionManager.ts`, `TmuxPaneSyncService.ts`                          | CLI session/pane operations and sync messages                                 |
| Zellij                | `ZellijSessionManager.ts`, `ZellijPaneSyncService.ts`                      | zellij session/pane operations and sync messages                              |
| Pane state            | `PaneStore.ts`                                                             | webview pane layout/state snapshots                                           |
| AI tools              | `aiTools/`                                                                 | operator-specific launch/file-reference behavior                              |
| Context               | `ContextManager.ts`, `ContextSharingService.ts`, `FileReferenceManager.ts` | active editor, diagnostics, `@file#L` formatting                              |
| Logging/capture       | `OutputChannelService.ts`, `OutputCaptureManager.ts`                       | singleton logger and shell output capture                                     |

## INSTANCE LAYER

```
InstanceStore
  ↑ hydrate/persist       ↑ discover/sync           ↑ user action
InstanceRegistry ── InstanceDiscoveryService ── InstanceController
                             ↓                         ↓
                       OpenCodeApiClient         PortManager + terminal managers
                             ↓
                    ConnectionResolver
```

## SINGLETONS / EVENTS

- `OutputChannelService.getInstance()` only; tests call `resetInstance()`.
- `portManager` is exported from `PortManager.ts`; avoid ad hoc port scans.
- `InstanceStore` uses Node `EventEmitter`.
- `FileReferenceManager`, terminal managers, and pane sync services expose VS Code-style disposables/listeners.

## CONVENTIONS

- Async service flows catch errors and log enough context to diagnose user-visible failures.
- Persisted instance config lives in registry; live runtime updates flow through `InstanceStore`.
- Backend-specific behavior belongs in backend managers/operators, not in provider glue.
- Tests are colocated except shared service tests in `src/services/__tests__/`.

## ANTI-PATTERNS

- No duplicated active-instance state outside `InstanceStore`.
- No direct construction of `OutputChannelService`.
- No raw tmux/zellij commands outside their session managers.
- No manual port selection outside `PortManager`.
- No bypassing `src/test/mocks` for VS Code or node-pty behavior.

## TESTING

- Run targeted tests for touched services before the full suite.
- Singleton/event tests must reset mocks and singleton state between cases.
