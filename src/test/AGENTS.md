# TEST KNOWLEDGE BASE

## OVERVIEW

Vitest unit tests use manual VS Code/node-pty mocks. E2E tests use `@vscode/test-electron` through the `vscode-test` script and compile separately.

## STRUCTURE

```
test/
├── mocks/
│   ├── vscode.ts          # manual VS Code API mock
│   ├── node-pty.ts        # createMockPtyProcess + simulation helpers
│   └── index.ts           # setupMocks/resetMocks
└── e2e/
    └── suite/             # Mocha-style VS Code extension tests
```

## WHERE TO LOOK

| Task                | Location                  | Notes                                                              |
| ------------------- | ------------------------- | ------------------------------------------------------------------ |
| VS Code API mock    | `mocks/vscode.ts`         | commands, window, workspace, EventEmitter, WebviewPanel/View fakes |
| PTY mock            | `mocks/node-pty.ts`       | `_simulateData`, `_simulateExit`, mock process helpers             |
| Mock setup/reset    | `mocks/index.ts`          | `vi.mock("vscode")`, `vi.mock("node-pty")`, reset helpers          |
| Vitest global setup | `../__tests__/setup.ts`   | global cleanup for unit tests                                      |
| E2E suite           | `e2e/suite/*.e2e.ts`      | activation, commands, config, session flows                        |
| Unit config         | `../../vitest.config.ts`  | include/exclude, coverage, `vscode` alias                          |
| E2E config          | `../../tsconfig.e2e.json` | compiles `src/test/e2e` to `out/test/e2e`                          |

## MOCK PATTERNS

```typescript
import { vi } from "vitest";

vi.mock("vscode");
vi.mock("node-pty", async () => {
  const actual = await vi.importActual("../test/mocks/node-pty");
  return actual;
});
```

## CONVENTIONS

- Unit tests are `src/**/*.test.ts` and usually colocated with the implementation.
- Use `src/test/mocks` instead of real VS Code windows, terminals, or PTYs.
- Reset singleton and event state between tests (`resetMocks()`, `resetInstance()`).
- Webview unit tests may use local DOM fakes because Vitest environment is `node`, not jsdom.
- Coverage thresholds: lines/functions/statements 80%, branches 70%; webview excluded.

## ANTI-PATTERNS

- Do not use `@vscode/test-electron` for unit tests.
- Do not mutate mock internals from tests when a helper already exists.
- Do not leave listeners, timers, singleton instances, or mock terminals alive across tests.

## COMMANDS

```bash
npm run test
npm run test:coverage
npm run compile:e2e
npm run test:e2e
```
