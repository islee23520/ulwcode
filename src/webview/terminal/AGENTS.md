# TERMINAL WEBVIEW KNOWLEDGE BASE

## OVERVIEW

xterm.js terminal assembly for the browser webview: config parsing, keyboard handling, resize/fit timing, HTML snippets, and tmux toolbar rendering.

## STRUCTURE

```
terminal/
├── index.ts                  # Terminal + addons + clipboard/drop/mouse setup
├── config.ts                 # reads data-* terminal config from HTML
├── keyboard.ts               # copy/paste/keybinding routing
├── resize.ts                 # initial fit, visibility refresh, resize observer
├── html.ts                   # terminal container HTML rendering
├── terminal-container.ts     # static container template helpers
├── ai-selector.ts/.html      # startup AI tool selector snippet
├── tmux-toolbar.ts/.html     # tmux command toolbar snippet
└── *.test.ts
```

## WHERE TO LOOK

| Task              | Location                               | Notes                                                   |
| ----------------- | -------------------------------------- | ------------------------------------------------------- |
| Initialize xterm  | `index.ts:initTerminal`                | addons, clipboard, links, drag/drop, resize cleanup     |
| Terminal settings | `config.ts`                            | font, cursor, scrollback, shell keybinding flag         |
| Keyboard behavior | `keyboard.ts`                          | always-terminal control keys, copy/paste decisions      |
| Initial rendering | `resize.ts:performInitialFit`          | double-rAF timing; sensitive to half-render regressions |
| HTML shape        | `html.ts`, `terminal-container.ts`     | host-injected data attributes consumed by config        |
| Toolbar           | `tmux-toolbar.ts`, `tmux-toolbar.html` | tmux controls rendered into terminal UI                 |

## CONVENTIONS

- Keep this directory browser-only.
- `initTerminal()` returns `{ terminal, fitAddon, dispose }`; every listener/addon added there must be disposed there.
- Preserve resize order: fit first, then refresh visible rows.
- Use `postMessage()` from `../shared/vscode-api` for host communication.
- HTML assets are imported through webpack raw handling; keep snippet IDs/classes stable for tests.

## ANTI-PATTERNS

- No Node imports or VS Code extension-host APIs.
- No direct `acquireVsCodeApi()` outside `shared/vscode-api`.
- No ad hoc keybinding exceptions without `keyboard.test.ts`.
- No resize timing simplification without checking half-render regression coverage.

## TESTING

- Run `npm run test -- src/webview/terminal` for targeted terminal tests.
- For layout/fit changes, also run pane/layout webview tests because terminal sizing depends on parent flex layout.
