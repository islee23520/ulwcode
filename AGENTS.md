# PROJECT KNOWLEDGE BASE

**Updated:** 2026-05-28 Asia/Seoul
**Commit:** 7f04ae2 | **Branch:** feat/dashboard-open-in-new-window

## OVERVIEW

VS Code extension — embeds Open Sidebar Terminal in the sidebar. PTY + HTTP communication + tmux session management.

## STRUCTURE

```
./
├── src/                     # extension host + webview source
│   ├── extension.ts         # VS Code entry (activate/deactivate)
│   ├── types.ts             # shared host↔webview message contracts
│   ├── core/                # lifecycle orchestration + command registration
│   ├── providers/           # VS Code webview providers (extension host side)
│   ├── services/            # stateful backend: instances, tmux, HTTP, context
│   ├── terminals/           # node-pty process management
│   ├── webview/             # browser-only code (xterm.js bundles)
│   ├── test/mocks/          # manual vscode + node-pty mocks
│   ├── utils/               # shared utilities
│   └── __tests__/           # vitest setup
├── dist/                    # webpack output (extension.js, webview.js, dashboard.js)
├── resources/               # activity bar icon
├── docs/, memories/         # ULW notes
└── package.json             # contribution points, scripts, config keys
```

## ARCHITECTURE

```
extension.ts → ExtensionLifecycle.activate()
  ├── 13 services created (manual DI, no container)
  ├── 2 providers registered (TerminalProvider, TerminalDashboardProvider)
  ├── CodeActionProvider registered
  └── command groups under core/commands/
```

**Webpack outputs:** extension.js, webview.js, dashboard.js

**Host↔Webview messages:** discriminated unions in `src/types.ts`

- `WebviewMessage` — webview→host (input, resize, file refs, tmux actions)
- `HostMessage` — host→webview (output, clipboard, visibility, platform)
- `TmuxDashboardActionMessage` — tmux dashboard actions

## WHERE TO LOOK

| Task                  | Location                                         | Notes                                                     |
| --------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| Activation / wiring   | `src/core/ExtensionLifecycle.ts`                 | service creation + provider registration + handoff consumption |
| Command registration  | `src/core/commands/`                             | terminalCommands, tmuxSessionCommands, tmuxPaneCommands, dashboardCommands |
| Main sidebar terminal | `src/providers/TerminalProvider.ts`              | Shell + MessageRouter + SessionRuntime                    |
| Terminal dashboard    | `src/providers/TerminalDashboardProvider.ts`     | Terminal Manager dashboard (inline HTML)                  |
| Instance state        | `src/services/InstanceStore.ts`                  | EventEmitter hub, all services depend here                |
| Tmux CLI wrapper      | `src/services/TmuxSessionManager.ts`             | Standalone, used by both providers                        |
| Cross-window handoff  | `src/services/SessionWindowHandoffService.ts`    | globalState-based session handoff between VS Code windows |
| HTTP API              | `src/services/OpenCodeApiClient.ts`              | Retry/backoff, prompt append                              |
| Browser terminal UI   | `src/webview/main.ts`                            | xterm.js + drag/drop + links                   |
| Shared contracts      | `src/types.ts`                                   | Message types, DTOs, ExtensionConfig                      |
| Test mocks            | `src/test/mocks/`                                | Manual vscode.ts + node-pty.ts (no @vscode/test-electron) |

## CODE MAP

| Symbol                 | Type     | Location                               | Role                                   |
| ---------------------- | -------- | -------------------------------------- | -------------------------------------- |
| `activate`             | function | `src/extension.ts`                     | VS Code extension entry                |
| `ExtensionLifecycle`   | class    | `src/core/ExtensionLifecycle.ts`       | Service creation, command registration, handoff consumption |
| `TerminalProvider`     | class    | `src/providers/TerminalProvider.ts`    | Main sidebar webview provider          |
| `SessionRuntime`       | class    | `src/providers/SessionRuntime.ts`      | Start/restart/tmux/instance switching  |
| `TmuxSessionManager`   | class    | `src/services/TmuxSessionManager.ts`   | tmux CLI: sessions, panes, attach      |
| `InstanceStore`        | class    | `src/services/InstanceStore.ts`        | In-memory instance state + events      |
| `SessionWindowHandoffService` | class | `src/services/SessionWindowHandoffService.ts` | Cross-window session handoff (globalState) |
| `TerminalManager`      | class    | `src/terminals/TerminalManager.ts`     | node-pty process lifecycle             |
| `OutputChannelService` | class    | `src/services/OutputChannelService.ts` | Singleton logger (`getInstance()`)     |

## SINGLETONS

- `OutputChannelService` — `getInstance()` static method + `resetInstance()` for tests
- `portManager` — module-level export in `PortManager.ts`

## EVENT PATTERNS

- `InstanceStore` — Node `EventEmitter`: `change`, `setActive`, `add`, `remove`
- `TerminalManager` — VS Code `EventEmitter`: `onData`, `onExit`
- `FileReferenceManager` — VS Code `EventEmitter`: `onDidAddReference`, `onDidRemoveReference`

## CONVENTIONS

- TypeScript `strict: true`; diagnostics must stay clean on changed files
- PascalCase classes; lowercase entrypoints (`extension.ts`, `main.ts`)
- Tests colocated as `*.test.ts`; manual mocks in `src/test/mocks/`
- Webview code = browser-only; extension host code = `providers/`, `services/`, `core/`
- `dist/` is the build output; never `out/`

## ANTI-PATTERNS (THIS PROJECT)

- No Node APIs in `src/webview` (`fs`, `path`, `os` are not available)
- No duplicating instance state outside `InstanceStore`
- No tmux logic in providers — use `TmuxSessionManager`
- New message shapes must update `src/types.ts`
- Never `new OutputChannelService()` — use `getInstance()`
- Never bypass mocks — follow existing patterns in `src/test/mocks/`

## KNOWN DEBT

- `TerminalDashboardProvider.ts` — inline HTML, needs split
- `PortManager` — created separately in provider and lifecycle (needs singleton consolidation)

## RECENT CHANGES

### Terminal half-rendering fix (branch: `fix/terminal-half-rendering`)
- `src/webview/terminal.css`: `#terminal-container` flex fix (`flex: 1 1 auto; height: auto`)
- `src/webview/layout/layout-engine.css`: `.layout-root` flex fix
- `src/webview/terminal/resize.ts`: double-rAF for initial fit timing

### Dashboard open-in-new-window (branch: `feat/dashboard-open-in-new-window`)
- `src/services/SessionWindowHandoffService.ts`: NEW — globalState-based cross-window handoff (async, TTL 2min)
- `src/core/commands/tmuxSessionCommands.ts`: `opencodeTui.openSessionInNewWindow` command
- `src/providers/TerminalDashboardProvider.ts`: activate → open in new window
- `src/core/ExtensionLifecycle.ts`: `consumeSessionHandoff()` on activation → focus sidebar
- `src/providers/SessionRuntime.ts`: backend resolution checks InstanceStore active instance runtime.terminalBackend

## BUILD & TEST

```bash
npm run compile          # dev build (webpack)
npm run watch            # watch mode
npm run package          # production build (--mode production)
npm run test             # vitest
npm run test:coverage    # vitest + coverage (80/80/70/80 thresholds)
- `npm run build-and-install` or `bash dev-install.sh` — build → package → install to VS Code
```

**Coverage:** lines 80%, functions 80%, branches 70%, statements 80%
**Webview excluded:** `src/webview/**` is excluded from coverage

## NOTES

- `vitest.config.ts` aliases `vscode` to `./src/test/mocks/vscode.ts`
- `.vscodeignore` excludes all agent artifacts (`.sisyphus/`, `.claude/`, `.opencode/`, etc.)
- Publish flow: tag-triggered (`v*`) → VS Code Marketplace + Open VSX dual publish
