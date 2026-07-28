# PROJECT KNOWLEDGE BASE

## OVERVIEW

VS Code extension that runs one native shell terminal in the secondary sidebar. The extension host owns one `node-pty` process; the webview owns one xterm.js instance.

## SOURCE TOPOLOGY

```text
src/
├── extension.ts                    # activate/deactivate entry
├── types.ts                        # seven-message host/webview contract
├── core/ExtensionLifecycle.ts      # creates and registers the terminal provider
├── providers/TerminalProvider.ts   # sidebar webview and PTY message bridge
├── terminals/TerminalManager.ts    # one native shell PTY lifecycle
├── webview/
│   ├── main.ts                     # one xterm bootstrap
│   ├── terminal/index.ts           # xterm input/output/resize/config bridge
│   ├── terminal/html.ts            # CSP-protected webview HTML
│   ├── terminal.css                # full-size terminal layout
│   └── shared/vscode-api.ts        # cached VS Code webview API
└── test/                           # unit mocks and one VS Code E2E smoke
```

## RUNTIME FLOW

```text
contributed view `ulw`
  -> TerminalProvider.resolveWebviewView()
  -> webview posts `ready`
  -> TerminalManager creates `sidebar-shell`
  -> node-pty data/exit events post to xterm
  -> xterm input/resize events write/resize the PTY
```

## CONTRACT

- Webview to host: `ready`, `input`, `resize`.
- Host to webview: `output`, `exit`, `config`, `focus`.
- No pane or session identifiers: exactly one terminal exists.

## CONVENTIONS

- Keep activation lazy through the contributed view; do not add startup activation.
- Keep the manifest free of commands, menus, and keybindings.
- Keep `node-pty` as the only runtime dependency. xterm and the fit addon are build-time dependencies bundled into `webview.js`.
- Do not add multiplexer, session, AI, HTTP, dashboard, editor-panel, file-context, or multi-pane features.
- Use `apply_patch` for edits and project scripts for verification.

## COMMANDS

```bash
npm run test
npx tsc -p tsconfig.json --noEmit
npm run compile:e2e
npm run lint
npm run package
npm run test:e2e
```
