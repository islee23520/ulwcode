# Testing

## Unit tests

```bash
npm run test
```

The focused suite covers:

- the one-view manifest topology;
- native shell selection and PTY creation;
- input, output, resize, exit, and disposal;
- the host/webview message contract;
- one xterm.js instance and its configuration updates;
- extension activation with exactly one `WebviewViewProvider`.

## Type checking, lint, and production build

```bash
npx tsc -p tsconfig.json --noEmit
npm run compile:e2e
npm run lint
npm run package
```

## VS Code E2E

```bash
npm run test:e2e
```

The test uses a real VS Code Extension Development Host. It subscribes to the PTY start and output events before opening the ULW sidebar, then sends a deterministic `printf` command and verifies the emitted output. It also asserts that exactly one PTY exists.

## Manual check

1. Run `npm run compile`.
2. Press F5 in VS Code.
3. Open the secondary sidebar and select **ULW**.
4. Run `printf 'ulw-ok\n'`.
5. Resize the sidebar and confirm the prompt continues to render across the full view.
6. Close the Extension Development Host and confirm the shell process exits.
