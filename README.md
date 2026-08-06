# ULW Sidebar Terminal

ULW is a small VS Code extension that runs one native shell terminal in the secondary sidebar.

It intentionally has no terminal multiplexer, session manager, AI integration, HTTP service, dashboard, or multi-pane layout. Opening ULW creates one `node-pty` process and connects it to one xterm.js terminal in either the secondary sidebar or an editor-group tab.

## Use

1. Install the extension.
2. Reload VS Code. ULW opens in an editor-group tab by default; set `ulw.defaultLocation` to `sidebar` to use the secondary sidebar instead.
3. Type directly in the terminal.

The shell starts in the first workspace folder. When no workspace is open, it starts in the user's home directory.

Run **ULW: Toggle Terminal Location** (`ulw.toggleEditorLocation`) to move the same shell between the secondary sidebar and an editor-group tab. Toggle again, or close the editor tab, to return to the sidebar. Switching surfaces reuses the same shell and replays recent scrollback into the newly focused xterm.

The terminal automatically inherits the active VS Code terminal palette, including ANSI colors, cursor colors, selections, and live theme changes. Drag-selecting terminal text copies the finished selection to the system clipboard.

## Commands

| Command | Purpose |
| --- | --- |
| `ulw.toggleEditorLocation` | Toggle the terminal between secondary sidebar and editor group |
| `ulw.sendSelectionToTerminal` | Send the active editor selection to the terminal |
| `ulw.sendFileToTerminal` | Send an explorer file path to the terminal |

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `ulw.defaultLocation` | `editor` | Open in an editor-group tab or the secondary sidebar |
| `ulw.fontSize` | `14` | Terminal font size |
| `ulw.fontFamily` | Nerd Font and monospace fallbacks | Terminal font family |
| `ulw.cursorBlink` | `true` | Blink the cursor |
| `ulw.cursorStyle` | `block` | `block`, `underline`, or `bar` |
| `ulw.scrollback` | `10000` | Scrollback line count |
| `ulw.shellPath` | empty | Shell executable; empty uses the VS Code or system default |
| `ulw.shellArgs` | `[]` | Arguments passed to the shell |

## Development

```bash
npm ci
npm run test
npm run lint
npm run package
npm run test:e2e
```

Production output is limited to `dist/extension.js` and `dist/webview.js`. The E2E test opens the actual sidebar view, waits for the PTY start event, sends a shell command, and verifies its output without fixed sleeps.

## Requirements

- VS Code 1.106 or newer
- Node.js 20 or newer

## License

MIT

## Acknowledgment

Based on [vscode-sidebar-terminal](https://github.com/s-hiraoku/vscode-sidebar-terminal) by s-hiraoku.
