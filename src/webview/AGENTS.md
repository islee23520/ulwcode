# WEBVIEW KNOWLEDGE BASE

## OVERVIEW

Browser-sandbox UI for xterm.js terminal panes, toolbar/drop/link behavior, and the Preact terminal manager dashboard.

## STRUCTURE

```
webview/
├── main.ts                         # browser terminal bootstrap
├── terminal/                       # xterm setup, keyboard, resize, HTML snippets
├── dashboard-manager.tsx           # dashboard bundle entry
├── dashboard/                      # Preact dashboard components/types/utils
├── pane-manager.ts                 # pane layout/store bridge in browser
├── pane-message-router.ts          # HostMessage routing by pane
├── layout/, tab-bar/, pane-actions/ # multi-pane UI controls
├── dragdrop/, clipboard/, links/    # browser integrations
├── shared/vscode-api.ts            # cached acquireVsCodeApi wrapper
└── __tests__/ + module *.test.ts
```

## WHERE TO LOOK

| Task               | Location                                                  | Notes                                                              |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Terminal bootstrap | `main.ts`                                                 | initializes pane manager, terminal, routers, toolbar/drop handlers |
| xterm instance     | `terminal/index.ts`                                       | Terminal + addons + clipboard + drag/drop + mouse tracking         |
| xterm sizing       | `terminal/resize.ts`                                      | initial double-rAF fit and visibility/resize handling              |
| Keyboard routing   | `terminal/keyboard.ts`                                    | copy/paste vs shell keybinding decisions                           |
| Host messages      | `messages/index.ts`, `pane-message-router.ts`             | typed `HostMessage` handling                                       |
| Multi-pane layout  | `pane-manager.ts`, `layout/`, `tab-bar/`, `pane-actions/` | pane create/delete/focus/split UI                                  |
| Dashboard UI       | `dashboard-manager.tsx`, `dashboard/components/`          | Preact dashboard cards/actions                                     |
| VS Code API        | `shared/vscode-api.ts`                                    | one cached `acquireVsCodeApi()` access point                       |

## CONVENTIONS

- Browser APIs only; no Node imports.
- Send webview-to-host data with `WebviewMessage` from `src/types.ts`.
- Keep rendering state local and shallow; backend/session truth comes from host messages.
- xterm fit/refresh order is timing-sensitive; preserve `fit()` then `refresh()` patterns.
- HTML snippets under `terminal/*.html` are bundled through webpack raw asset handling.

## ANTI-PATTERNS

- No extension-host logic or VS Code `window/workspace` calls.
- No hardcoded duplicate message contracts.
- No ad hoc DOM updates that skip the existing pane/router flow.
- No focus color hardcoding or focus-toggle motion in `focus/focus-manager.css`.

## BUILD / TEST

- Webpack emits `dist/webview.js` from `main.ts` and `dist/dashboard.js` from `dashboard-manager.tsx`.
- Unit tests run in Vitest node environment with DOM-like fakes as needed; `src/webview/**` is excluded from coverage thresholds.
