# ULW Guide

[English (default)](../README.md) · [한국어](../ko/README.md) · [日本語](../ja/README.md)

- [Default English guide](../README.md)
- [Root README](../../README.md)

This guide explains how to install and use **ULW** as an Open TUI terminal MUX inside VS Code.

## Overview

ULW embeds OpenCode, Claude, Codex, custom AI tools, or a native shell directly in the VS Code sidebar instead of the native terminal panel.

It provides two main sidebar views:

1. **ULW Terminal** in the secondary sidebar for the interactive TUI session.
2. **ULW Terminal Manager** for managing `tmux` sessions, panes, and windows.

## Key Features

- Auto-launch **OpenCode** when the terminal view is activated.
- Full TUI rendering with `xterm.js` and WebGL.
- Multi-AI tool support for OpenCode, Claude, Codex, or custom tools.
- Integrated `tmux` session discovery and workspace-aware filtering.
- Native shell switching inside the same terminal surface.
- HTTP API communication with OpenCode for prompts and context sharing.
- File references with line numbers such as `@filename#L10-L20`.
- Context menu actions, drag and drop, and keyboard shortcuts.

## Installation

### Install from VS Code Marketplace

1. Open VS Code.
2. Open Extensions with `Cmd+Shift+X` or `Ctrl+Shift+X`.
3. Search for **ULW**.
4. Click **Install**.

### Install from OpenVSX

For VSCodium, Gitpod, Eclipse Theia, and other compatible IDEs:

1. Open the extension view.
2. Search for **ULW**.
3. Click **Install**.

You can also use the [OpenVSX page](https://open-vsx.org/extension/islee23520/ulwcode).

### Install from Source

```bash
git clone https://github.com/islee23520/ulwcode.git
cd ulwcode
npm install
npm run compile
npx @vscode/vsce package
```

Then install the generated VSIX from the Extensions view with **Install from VSIX**.

## Quick Start

1. Open **ULW Terminal Manager** when you need to manage `tmux` sessions.
2. Open **ULW Terminal** in the secondary sidebar.
3. Let ULW auto-start OpenCode, or start it manually.
4. Work with OpenCode directly inside the sidebar.

### Common Shortcuts

| Shortcut                   | Action                        |
| -------------------------- | ----------------------------- |
| `Cmd+Alt+L` / `Ctrl+Alt+L` | Send current file reference   |
| `Cmd+Alt+A` / `Ctrl+Alt+A` | Send all open file references |
| `Cmd+Alt+T` / `Ctrl+Alt+T` | Browse `tmux` sessions        |
| `Cmd+V` / `Ctrl+V`         | Paste into the terminal       |

## Working with Files and Context

ULW supports several ways to share context with OpenCode:

- **File reference command**: send `@filename`, `@filename#L10`, or `@filename#L10-L20`.
- **Context menu integration**: send files, folders, or editor selections.
- **Drag and drop**: hold **Shift** and drop files or folders into the terminal.
- **Auto-context sharing**: automatically sends open files and active selections when the terminal opens.

The file-reference syntax stays the same in every language guide:

- `@filename`
- `@filename#L10`
- `@filename#L10-L20`

## ULW Terminal Manager and tmux

**ULW Terminal Manager** is the control center for `tmux` workflows.

It includes:

- Automatic session discovery.
- Workspace-scoped filtering.
- Pane controls for split, focus, resize, swap, and kill.
- Window controls for next, previous, create, select, and kill.
- A quick banner to return to the active workspace session.
- Hidden `tmux` status bar in the sidebar to save vertical space.

### Common tmux Actions

- **Spawn Tmux Session for Workspace**
- **Select OpenCode Tmux Session**
- **Switch Tmux Session**
- **Split Pane Horizontal / Vertical**
- **Create Window**
- **Kill Pane / Kill Window / Kill Session**

## HTTP API Integration

ULW uses an HTTP API to communicate with OpenCode more reliably.

### What it does

- Discovers the OpenCode HTTP server automatically.
- Checks `/health` before sending requests.
- Sends prompts and file references to `/tui/append-prompt`.
- Uses retry logic and timeout handling.

### How it works

1. OpenCode starts an HTTP server on an ephemeral port.
2. The extension discovers that port.
3. The extension sends prompts and context over HTTP.
4. The sidebar WebView handles terminal input and output rendering.

## Configuration Highlights

The most important settings stay in English because they must match the real VS Code setting keys.

### Terminal and Startup

| Setting                       | Description                                             |
| ----------------------------- | ------------------------------------------------------- |
| `ulw.autoStart`       | Start the configured AI tool automatically when the view is activated |
| `ulw.autoStartOnOpen` | Start the configured AI tool when the sidebar opens                   |
| `ulw.fontSize`        | Terminal font size                                      |
| `ulw.fontFamily`      | Terminal font family                                    |
| `ulw.terminal.defaultLocation` | Default terminal location: `editor` or `sidebar`        |
| `ulw.autoFocusOnSend` | Focus ULW after sending file references                 |

### HTTP API and Context Sharing

| Setting                         | Description                        |
| ------------------------------- | ---------------------------------- |
| `ulw.enableHttpApi`     | Enable HTTP API communication      |
| `ulw.httpTimeout`       | Request timeout in milliseconds    |
| `ulw.autoShareContext`  | Share editor context automatically |
| `ulw.contextDebounceMs` | Debounce delay for context updates |

### AI Tool and tmux Behavior

| Setting                          | Description                                       |
| -------------------------------- | ------------------------------------------------- |
| `ulw.aiTools`            | Configure available AI tools                      |
| `ulw.defaultAiTool`      | Default tool for new `tmux` sessions              |
| `ulw.enableAutoSpawn`    | Auto-spawn OpenCode if it is not already running  |
| `ulw.nativeShellDefault` | Default behavior when switching to a native shell |
| `ulw.tmuxSessionDefault` | Default behavior for new `tmux` sessions          |

## Requirements

- VS Code `1.106.0` or higher
- Node.js `20.0.0` or higher
- OpenCode installed and available through the `opencode` command

## More Information

For the full command list, complete setting reference, development workflow, and implementation details, see the [root README](../../README.md).
