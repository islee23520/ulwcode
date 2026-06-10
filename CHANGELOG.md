# Changelog

All notable changes to the "ULW" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.12.0] - 2026-06-10

### Changed

- Start the sidebar from `ulw.terminalBackend` only (`native`, `tmux`, or `zellij`) with a plain shell or multiplexer attach—no default AI tool or startup tool picker.
- Remove dashboard AI launch actions and host/webview `launchAiTool` / `launchDefaultAiTool` flows.

### Removed

- VS Code settings `ulw.aiTools` and `ulw.defaultAiTool`.
- AI tool selector e2e suite and related manifest/docs references.

### Fixed

- Align unit, coverage, and e2e tests with backend-first startup and removed launch APIs.

## [1.11.0] - 2026-06-03

### Added

- Add independent editor-terminal pane identities so each editor tab gets its own `ulw-editor-N` surface.

### Fixed

- Preserve the existing `islee23520.opencode-sidebar-tui` extension ID so current Marketplace/Open VSX users receive the ULW update in place.
- Fix tmux-backed editor terminal tabs reusing the sidebar/default pane session.
- Fix editor terminal input and resize messages so they target the correct editor pane.
- Correct the triage plan GitHub checks command to use the `islee23520/ulwcode` repository.

## [1.8.0] - 2026-05-18

### Added

- Add multi-backend terminal support with `native`, `tmux`, and `zellij` backend selection.
- Add native terminal backend support with ask-first AI tool selection.
- Add `ulw.terminalBackend` setting for choosing the terminal backend.
- Add `ulw.sendKeybindingsToShell` so terminal-focused Ctrl/Cmd shortcuts can be passed through to the TUI.

### Changed

- Change `ulw.autoStartOnOpen` default to `false` so users can choose which AI tool to launch when opening the sidebar.
- Rename dashboard command labels to `Open ULW Terminal Manager` for clearer VS Code command palette and menu wording.
- Improve Windows compatibility and terminal UX around shell handling, paths, clipboard behavior, and terminal focus.
- Expand automated test coverage across core commands, providers, services, terminals, webview keyboard handling, and VS Code mocks.

### Fixed

- Fix Shift+Enter newline handling in the sidebar terminal.
- Fix editor title actions so `Open Terminal in Editor` and `Open ULW Terminal Manager` only appear after the extension is fully active.
- Fix package repository URL metadata by removing the leading whitespace.

### Security

- Update dependency lockfile entries for `postcss`, `fast-uri`, `brace-expansion`, `ajv`, and `serialize-javascript`.
- Add a `serialize-javascript` override to force `^7.0.5`.

## [1.4.1] - 2026-03-03

### Fixed

- Fix all "Send to OpenCode" commands broken after 1.4.0 multi-instance patch
  - Root cause: `OpenCodeTuiProvider.startOpenCode()` did not write `terminalKey` into the InstanceStore, causing `getActiveTerminalId()` to resolve to a non-existent terminal ID
  - On fresh installs (empty store), `getActive()` threw → fallback to `"opencode-main"`, while the actual terminal was created with ID `"default"` → silent mismatch
  - Fixed by ensuring the instance store record is created/updated with the correct `terminalKey` after terminal creation
- Fix `sendFileToTerminal` (Send File Reference) not working from editor and explorer context menus
- Fix `sendAtMention` (Send @file) not working
- Fix `sendAllOpenFiles` (Send All Open Files) not working
- Fix `sendToTerminal` (Send Selected Text) not working

### Improved

- Support multi-file selection in Explorer context menu — selecting multiple files and using "Send to OpenCode" now sends all selected files as `@file1 @file2 @file3`
- Replace notification popups (`showInformationMessage`) with transient status bar messages (`setStatusBarMessage`) when sending files — less intrusive UX

## [1.3.2] - 2026-02-20

### Fixed

- Support multi-file selection in Explorer context menu - multiple files are now sent together as `@file1 @file2 @file3`
- Improve drag-and-drop handling for VS Code editor tabs - files dragged from editor tabs are now properly captured
- Remove duplicate "Send to OpenCode Terminal" from editor context menu - only "Send File Reference (@file)" remains
- Fix multi-file drag-and-drop from Explorer - all selected files are now processed instead of just the first one

## [1.1.0] - 2025-02-06

### Added

- **HTTP API Integration**: Bidirectional communication with OpenCode CLI via HTTP API
  - Auto-discovery of OpenCode CLI HTTP server on ephemeral ports (16384-65535)
  - Health check endpoint (`/health`) for availability validation
  - Prompt append endpoint (`/tui/append-prompt`) for sending commands
  - Exponential backoff retry logic for reliable communication
  - Configurable timeout (default: 5000ms)

- **Auto-Context Sharing**: Automatically shares editor context when terminal opens
  - Shares all open files on terminal startup
  - Includes line numbers for active selections
  - Format: `@path/to/file#L10-L20`
  - Configurable via `ulw.autoShareContext` setting

- **Port Management Service**: Ephemeral port allocation for HTTP communication
  - Port range: 16384-65535 (standard ephemeral range)
  - Collision detection and prevention
  - Per-terminal port tracking
  - Automatic cleanup on terminal closure

- **Context Sharing Service**: Editor context detection and formatting
  - Detects current file and selection
  - Formats file references with line numbers
  - Supports `@file`, `@file#L10`, `@file#L10-L20` formats

- **New Configuration Options**:
  - `ulw.enableHttpApi`: Enable/disable HTTP API (default: `true`)
  - `ulw.httpTimeout`: HTTP request timeout in milliseconds (default: `5000`, range: 1000-30000)
  - `ulw.autoShareContext`: Auto-share editor context on terminal open (default: `true`)

### Changed

- **Architecture Documentation**: Clarified sidebar-only architecture
  - Added explicit note that this is a sidebar-only extension (not native VS Code: terminal)
  - Documented HTTP API vs WebView messaging architecture
  - Updated feature list to highlight HTTP API capabilities

- **Communication Method**: Migrated from terminal I/O to HTTP API for reliable bidirectional communication
  - More reliable than terminal stdin/stdout parsing
  - Better error handling and retry capabilities
  - Cleaner separation of concerns

### Technical

- Added `OpenCodeApiClient` for HTTP communication with retry logic
- Added `PortManager` for ephemeral port allocation
- Added `ContextSharingService` for editor context detection
- Added `TerminalDiscoveryService` for terminal integration
- Added `OutputCaptureManager` for output handling
- Comprehensive test coverage for all new services

## [1.0.4] - 2025-01-XX

### Added

- Initial release with core functionality
- Auto-launch OpenCode when sidebar is activated
- Full TUI support with xterm.js and WebGL rendering
- File references with line numbers (`@filename#L10-L20`)
- Keyboard shortcuts (`Cmd+Alt+L`, `Cmd+Alt+A`)
- Drag & drop support for files
- Context menu integration
- Configurable terminal settings

### Features

- **Terminal Management**: node-pty backend with xterm.js frontend
- **File References**: Send current file or selection to OpenCode
- **Keyboard Shortcuts**: Quick access commands
- **Context Menus**: Right-click integration in Explorer and Editor
- **Drag & Drop**: Shift-drag files to send as references
- **Configuration**: Customizable command, font, and terminal settings

[1.3.2]: https://github.com/islee23520/ulwcode/compare/v1.1.0...v1.3.2
[1.1.0]: https://github.com/islee23520/ulwcode/compare/v1.0.4...v1.1.0
[1.0.4]: https://github.com/islee23520/ulwcode/releases/tag/v1.0.4
