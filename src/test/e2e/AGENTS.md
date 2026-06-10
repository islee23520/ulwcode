# E2E TEST KNOWLEDGE BASE

## OVERVIEW

VS Code extension integration tests compiled separately from unit tests and executed by `vscode-test`.

## STRUCTURE

```
e2e/
└── suite/
    ├── activation.e2e.ts
    ├── webview.e2e.ts
    ├── commands.e2e.ts
    ├── command-behavior.e2e.ts
    ├── commands-comprehensive.e2e.ts
    ├── session-flows.e2e.ts
    ├── contributions.e2e.ts
    ├── config-comprehensive.e2e.ts
    └── settings.e2e.ts
```

## WHERE TO LOOK

| Task                 | Location                                                                       | Notes                                 |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------------- |
| Activation smoke     | `suite/activation.e2e.ts`                                                      | extension activation in VS Code host  |
| Webview registration | `suite/webview.e2e.ts`                                                         | sidebar/webview contribution behavior |
| Command registration | `suite/commands.e2e.ts`, `commands-comprehensive.e2e.ts`                       | contributed command coverage          |
| Command behavior     | `suite/command-behavior.e2e.ts`                                                | command execution assertions          |
| Session flows        | `suite/session-flows.e2e.ts`                                                   | tmux/session workflows                |
| Manifest/config      | `suite/contributions.e2e.ts`, `config-comprehensive.e2e.ts`, `settings.e2e.ts` | package contribution checks           |


## CONVENTIONS

- Source root is `src/test/e2e`; output root is `out/test/e2e`.
- `tsconfig.e2e.json` uses CommonJS, Mocha, Node, and VS Code types.
- `npm run test:e2e` runs `pretest:e2e` first, so it builds webpack and compiles e2e tests.
- Keep e2e assertions focused on extension surface behavior; unit tests own detailed service edge cases.

## ANTI-PATTERNS

- Do not import Vitest helpers here; these tests run under the VS Code test runner/Mocha stack.
- Do not depend on generated `out/test/e2e` files as source.
- Do not duplicate every unit scenario in e2e; cover activation, manifest, commands, and representative flows.

## COMMANDS

```bash
npm run compile:e2e
npm run test:e2e
```
