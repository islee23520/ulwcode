# PROJECT KNOWLEDGE BASE

## OVERVIEW

VS Code extension that runs one native shell terminal in the secondary sidebar or an editor-group tab. The extension host owns one `node-pty` process; each surface owns one xterm.js instance, with one active surface at a time.

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
sidebar: contributed view `ulw` -> resolveWebviewView()
editor:  ulw.defaultLocation=editor (default) | ulw.toggleEditorLocation -> createWebviewPanel
  -> active surface posts `ready`
  -> TerminalManager creates or resizes `sidebar-shell`
  -> scrollback replay when switching to a fresh xterm
  -> node-pty data/exit events post to surfaces
  -> active surface input/resize events write/resize the PTY
```

## CONTRACT

- Webview to host: `ready`, `input`, `resize`, `copy`, `imagePasted`.
- Host to webview: `output`, `exit`, `config`, `focus`, `clipboardImage`.
- No pane or session identifiers: exactly one terminal process exists.
- One active surface at a time: secondary-sidebar webview or one editor-group webview panel.
- `ulw.toggleEditorLocation` moves that single shell between surfaces.

## CONVENTIONS

- Activate for the sidebar view, contributed commands, and startup (so `ulw.defaultLocation=editor` can open an editor tab).
- Keep contributed commands limited to location toggle and send-to-terminal helpers; no keybindings.
- Keep `node-pty` as the only runtime dependency. xterm and the fit addon are build-time dependencies bundled into `webview.js`.
- Do not add multiplexer, session, AI, HTTP, dashboard, file-context, or multi-pane features.
- One editor panel max for the shared shell; never spawn a second PTY for editor mode.
- Honor `ulw.defaultLocation` (`editor` default | `sidebar`); toggle always overrides the current surface.
- Use project scripts for verification.

## COMMANDS

```bash
npm run test
npx tsc -p tsconfig.json --noEmit
npm run compile:e2e
npm run lint
npm run package
npm run test:e2e
```
