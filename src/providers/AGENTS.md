# PROVIDERS KNOWLEDGE BASE

## OVERVIEW

VS Code extension-host bridge between webviews, commands, and backend services. Providers own view lifecycle and routing, not business state.

## STRUCTURE

```
providers/
├── TerminalProvider.ts            # sidebar/editor terminal webview lifecycle
├── MessageRouter.ts               # WebviewMessage dispatch and host-side handlers
├── SessionRuntime.ts              # native/tmux/zellij process/session runtime
├── TerminalDashboardProvider.ts   # terminal manager provider shell
├── CodeActionProvider.ts          # explain/fix code actions
└── *.test.ts
```

## WHERE TO LOOK

| Task                     | Location                       | Notes                                                                 |
| ------------------------ | ------------------------------ | --------------------------------------------------------------------- |
| Terminal webview shell   | `TerminalProvider.ts`          | `resolveWebviewView`, editor panels, HTML/CSP, pending message queue  |
| Browser message handling | `MessageRouter.ts`             | terminal I/O, clipboard, image paste, file open/drop, backend actions |
| Session runtime          | `SessionRuntime.ts`            | startup/restart, pane sessions, backend selection, HTTP polling       |
| Dashboard provider       | `TerminalDashboardProvider.ts` | dashboard view/editor wiring and dashboard actions                    |
| Code actions             | `CodeActionProvider.ts`        | sends selected diagnostics/context to terminal                        |

## RESPONSIBILITY MAP

| Module                      | Owns                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `TerminalProvider`          | VS Code webview lifecycle, CSP/nonce, editor-panel bridge, outbound host messages      |
| `MessageRouter`             | typed `WebviewMessage` dispatch and VS Code API side effects                           |
| `SessionRuntime`            | terminal process/session state transitions and backend-specific launch/switch behavior |
| `TerminalDashboardProvider` | dashboard HTML/webview shell and tmux/zellij/native action fan-out                     |

## CONVENTIONS

- Providers run in extension host, so VS Code and Node APIs are allowed here.
- Accept only message shapes from `src/types.ts`.
- Use `SessionRuntime` for start/switch/restart; use services for tmux/zellij/API details.
- Preserve pane IDs when relaying pane-scoped host messages.

## ANTI-PATTERNS

- No DOM rendering logic here; browser behavior belongs in `src/webview`.
- No independent instance state; read/write through `InstanceStore` and runtime helpers.
- No raw tmux/zellij CLI calls from providers.
- No arbitrary dashboard action payloads; extend typed DTOs first.

## TESTING

- Provider tests are large and fixture-heavy; keep new behavior covered in the matching `*.test.ts`.
- For webview-facing changes, add router/provider assertions plus a webview unit test when browser code changes too.
