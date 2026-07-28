# ULW Sidebar Terminal

ULW is a small VS Code extension that runs one native shell terminal in the secondary sidebar.

It intentionally has no terminal multiplexer, session manager, AI integration, HTTP service, dashboard, editor panel, or multi-pane layout. Opening the ULW view creates one `node-pty` process and connects it to one xterm.js terminal.

## Use

1. Install the extension.
2. Open the VS Code secondary sidebar.
3. Select **ULW**.
4. Type directly in the terminal.

The shell starts in the first workspace folder. When no workspace is open, it starts in the user's home directory.

The terminal automatically inherits the active VS Code terminal palette, including ANSI colors, cursor colors, selections, and live theme changes.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
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
