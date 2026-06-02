# PROJECT KNOWLEDGE BASE

**Updated:** 2026-06-01 Asia/Seoul
**Commit:** ec74a99 | **Branch:** feat/dashboard-open-in-new-window

## OVERVIEW

VS Code extension that embeds ULW Terminal in the secondary sidebar. Extension host code manages PTY/native terminals, tmux/zellij sessions, HTTP prompt delivery, and VS Code state; webview code renders xterm.js and the terminal manager dashboard.

## STRUCTURE

```
./
├── src/
│   ├── extension.ts          # VS Code activate/deactivate entry
│   ├── types.ts              # host-webview DTOs, backend/tool config, tmux dashboard DTOs
│   ├── core/                 # activation, service wiring, command groups
│   ├── providers/            # VS Code webview providers and host-side message routing
│   ├── services/             # instance/session/backend state, tmux/zellij/API/context
│   ├── terminals/            # node-pty lifecycle wrapper
│   ├── webview/              # browser-only xterm/dashboard UI
│   ├── test/                 # e2e suite + manual vscode/node-pty mocks
│   └── __tests__/            # Vitest setup and cross-module regression tests
├── dist/                     # webpack output: extension.js, webview.js, dashboard.js
├── out/                      # tsc e2e output; generated
├── coverage/                 # Vitest coverage; generated
├── resources/                # activity bar icons
├── docs/, memories/          # notes and planning artifacts
└── package.json              # extension manifest, commands, config keys, scripts
```

## ARCHITECTURE

```
package.json main -> dist/extension.js
src/extension.ts -> ExtensionLifecycle.activate()
  ├── creates stateful services by manual DI
  ├── registers TerminalProvider + TerminalDashboardProvider
  ├── registers command groups from core/commands/
  ├── consumes SessionWindowHandoffService payloads on activation
  └── registers CodeActionProvider
```

Host-webview messages are discriminated unions in `src/types.ts`: `WebviewMessage`, `HostMessage`, `TmuxDashboardActionMessage`, and dashboard DTOs. New message shapes must update this file and the matching router/tests.

## WHERE TO LOOK

| Task                      | Location                                                                                   | Notes                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Activation / DI           | `src/core/ExtensionLifecycle.ts`                                                           | service creation, provider registration, handoff consumption |
| Command wiring            | `src/core/commands/`                                                                       | terminal, tmux session, tmux pane, dashboard command modules |
| Sidebar terminal shell    | `src/providers/TerminalProvider.ts`                                                        | webview lifecycle, HTML/CSP, pane/editor panel bridge        |
| Host message handlers     | `src/providers/MessageRouter.ts`                                                           | webview input, clipboard, drops, VS Code terminal bridge     |
| Runtime/session switching | `src/providers/SessionRuntime.ts`                                                          | native/tmux/zellij startup, pane state, HTTP readiness       |
| Terminal dashboard        | `src/providers/TerminalDashboardProvider.ts` + `src/webview/dashboard-manager.tsx`         | provider shell + Preact dashboard bundle                     |
| Instance state            | `src/services/InstanceStore.ts`                                                            | in-memory EventEmitter hub; do not duplicate state           |
| Instance lifecycle        | `src/services/InstanceController.ts`, `InstanceDiscoveryService.ts`, `InstanceRegistry.ts` | spawn/connect/discover/persist                               |
| Tmux/zellij CLI           | `src/services/TmuxSessionManager.ts`, `ZellijSessionManager.ts`                            | backend-specific process/session wrappers                    |
| AI tool behavior          | `src/services/aiTools/` + `src/types.ts`                                                   | OpenCode/Claude/Codex launch and file-reference formatting   |
| Browser terminal UI       | `src/webview/main.ts`, `src/webview/terminal/`                                             | xterm.js setup, keyboard, resize, toolbar HTML               |
| Tests and mocks           | `src/test/`, `src/**/*.test.ts`                                                            | Vitest, manual mocks, e2e suite                              |

## CODE MAP

| Symbol                   | Type     | Location                                         | Role                                          |
| ------------------------ | -------- | ------------------------------------------------ | --------------------------------------------- |
| `activate`               | function | `src/extension.ts`                               | VS Code entry                                 |
| `ExtensionLifecycle`     | class    | `src/core/ExtensionLifecycle.ts`                 | activation, DI, command/provider registration |
| `TerminalProvider`       | class    | `src/providers/TerminalProvider.ts`              | webview lifecycle and provider API            |
| `MessageRouter`          | class    | `src/providers/MessageRouter.ts`                 | host-side `WebviewMessage` dispatch           |
| `SessionRuntime`         | class    | `src/providers/SessionRuntime.ts`                | session/process/backend runtime               |
| `InstanceStore`          | class    | `src/services/InstanceStore.ts`                  | active instance state + events                |
| `InstanceController`     | class    | `src/services/InstanceController.ts`             | spawn/connect/disconnect/kill                 |
| `ConnectionResolver`     | class    | `src/services/ConnectionResolver.ts`             | stored/discovered/spawned HTTP resolution     |
| `TmuxSessionManager`     | class    | `src/services/TmuxSessionManager.ts`             | tmux CLI wrapper                              |
| `ZellijSessionManager`   | class    | `src/services/ZellijSessionManager.ts`           | zellij CLI wrapper                            |
| `TerminalManager`        | class    | `src/terminals/TerminalManager.ts`               | node-pty process lifecycle                    |
| `AiToolOperatorRegistry` | class    | `src/services/aiTools/AiToolOperatorRegistry.ts` | resolves OpenCode/Claude/Codex operators      |

## CONVENTIONS

- TypeScript `strict: true`; extension host compiles through webpack/ts-loader, e2e compiles through `tsconfig.e2e.json`.
- PascalCase classes; lowercase entrypoints (`extension.ts`, `main.ts`).
- Tests colocated as `*.test.ts`; e2e tests live under `src/test/e2e/suite`.
- Manual DI only; no container. Dependencies flow from `ExtensionLifecycle`.
- Webview code is browser-only. Extension host code lives under `core/`, `providers/`, `services/`, `terminals/`.
- Webpack emits to `dist/`; e2e tsc emits to `out/`; never rely on generated `coverage/`, `dist/`, or `out/` as source.

## ANTI-PATTERNS (THIS PROJECT)

- No Node APIs in `src/webview` (`fs`, `path`, `os`, `child_process` are unavailable).
- No duplicating instance/session state outside `InstanceStore` and `PaneStore`.
- No tmux/zellij CLI logic in providers; use the session managers.
- No arbitrary host-webview payloads; update `src/types.ts` first.
- Never `new OutputChannelService()`; use `OutputChannelService.getInstance()`.
- Never bypass `src/test/mocks` in unit tests.
- Do not hardcode focus colors or add focus-toggle motion in `src/webview/focus/focus-manager.css`.

## COMMANDS

```bash
npm run compile          # webpack dev build
npm run package          # production webpack build
npm run lint             # eslint src --ext ts
npm run test             # Vitest unit tests
npm run test:coverage    # Vitest coverage, 80/80/70/80 thresholds
npm run compile:e2e      # tsc e2e suite to out/test/e2e
npm run test:e2e         # vscode-test, after pretest:e2e
npm run build-and-install
```

## NOTES

- `vitest.config.ts` aliases `vscode` to `src/test/mocks/vscode.ts`; `node-pty` is mocked through local helpers.
- `package.json` declares 28 extension configuration keys and many contributed commands; update manifest tests when changing them.
- Publish workflow is tag-triggered on `v*` and publishes to VS Code Marketplace + Open VSX.
- Current known debt: `TerminalDashboardProvider.ts` still owns inline HTML/provider glue; port allocation has both singleton export and provider/lifecycle wiring history.
