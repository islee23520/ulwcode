# CORE KNOWLEDGE BASE

## OVERVIEW

Activation, service wiring, and command registration. This layer should orchestrate dependencies, not own terminal or tmux behavior.

## STRUCTURE

```
core/
├── ExtensionLifecycle.ts        # activation/deactivation, manual DI, provider registration
├── ExtensionLifecycle.test.ts
└── commands/
    ├── index.ts                 # registerCommands(context, deps)
    ├── terminalCommands.ts      # terminal start/restart/paste/file-reference commands
    ├── tmuxSessionCommands.ts   # tmux/session selection, spawn, open in new window
    ├── tmuxPaneCommands.ts      # pane split/switch/send/resize/swap helpers
    └── dashboardCommands.ts     # terminal manager editor/dashboard commands
```

## WHERE TO LOOK

| Task                  | Location                                       | Notes                                                             |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Activation flow       | `ExtensionLifecycle.ts`                        | creates services, registers providers, then commands              |
| Handoff consumption   | `ExtensionLifecycle.ts:consumeSessionHandoff`  | `SessionWindowHandoffService` -> `InstanceStore` -> sidebar focus |
| Prompt routing        | `ExtensionLifecycle.ts:sendPromptToOpenCode`   | active client first, discovered instance fallback                 |
| Command deps          | `ExtensionLifecycle.ts:getCommandDependencies` | getters prevent stale references                                  |
| Command entry         | `commands/index.ts`                            | central registration fan-out                                      |
| Terminal commands     | `commands/terminalCommands.ts`                 | send/paste/file reference commands                                |
| Tmux session commands | `commands/tmuxSessionCommands.ts`              | session quick picks and cross-window command                      |
| Tmux pane commands    | `commands/tmuxPaneCommands.ts`                 | pane quick picks and raw tmux action wrappers                     |
| Dashboard commands    | `commands/dashboardCommands.ts`                | editor dashboard HTML helpers                                     |

## CONVENTIONS

- Register commands only through `commands/index.ts`.
- Dependency objects expose functions/getters for mutable provider/service references.
- Keep tmux/zellij behavior in services; command modules should select inputs and call a manager/runtime.
- Activation should log actionable errors through `OutputChannelService.getInstance()`.

## ANTI-PATTERNS

- No provider-owned command registration.
- No tmux pane/session implementation inside lifecycle.
- No direct `globalState` handoff reads outside `SessionWindowHandoffService`.
- No command IDs that exist only in code; mirror contributed commands in `package.json` and tests.

## TESTING

- Unit tests are adjacent: `ExtensionLifecycle.test.ts`, `commands/*.test.ts`.
- Command tests should mock VS Code APIs through `src/test/mocks`, not `@vscode/test-electron`.
