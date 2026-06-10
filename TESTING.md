# Testing Guide

## Manual Testing Steps

### 1. Build the Extension

```bash
cd ~/workspace/tool/ulwcode
npm install
npm run compile
```

### 2. Package the Extension

```bash
npx @vscode/vsce package
```

This will create a `.vsix` file (e.g., `ulwcode-0.1.0.vsix`)

### 3. Install in VS Code

Option A: Via Command Line

```bash
code --install-extension ulwcode-0.1.0.vsix
```

Option B: Via VS Code UI

1. Open VS Code
2. Go to Extensions (Cmd+Shift+X)
3. Click "..." menu → "Install from VSIX..."
4. Select the `.vsix` file

### 4. Test the Extension

1. **Open the sidebar**
   - Click the ULW icon in the activity bar
   - Or use Command Palette: "View: Show ULW"

2. **Verify auto-start**
   - OpenCode should start automatically
   - You should see the ULW Terminal interface

3. **Test commands**
   - Try a command from the `ULW` command category

4. **Test terminal interaction**
   - Type commands in the terminal
   - Verify input/output works correctly
   - Test scrollback (scroll up/down)

5. **Test configuration**
   - Open Settings (Cmd+,)
   - Search for "opencode"
   - Try changing:
     - Font size
     - Cursor style
     - Auto-start behavior

### 5. Development Mode (F5)

For rapid testing during development:

1. Open the project in VS Code
2. Press F5 to launch Extension Development Host
3. A new VS Code window opens with the extension loaded
4. Test changes immediately

### Expected Behavior

✅ ULW appears in activity bar
✅ Terminal automatically starts with OpenCode
✅ Full TUI interaction works (keyboard, mouse)
✅ Terminal renders correctly (colors, formatting)
✅ Scrollback works properly
✅ Commands execute successfully

### Common Issues

**Terminal not starting?**

- Check `ulw.terminalBackend` (`native`, `tmux`, or `zellij`) and that `tmux`/`zellij` is installed if you use those backends
- For HTTP/OpenCode features only: ensure `opencode` is on PATH, or set `ulw.enableAutoSpawn` to `false` if you do not want background spawn

**Rendering issues?**

- WebGL might not be available → extension falls back to canvas
- Check browser console in DevTools (Help → Toggle Developer Tools)

**Extension not appearing?**

- Reload VS Code window (Cmd+R)
- Check Output → Extension Host logs

## Automated Testing (Future)

Testing framework setup:

```bash
npm install --save-dev @vscode/test-electron
npm run test
```

Test areas to cover:

- [ ] Extension activation
- [ ] Terminal process lifecycle
- [ ] WebView message passing
- [ ] Configuration handling
- [ ] Command registration
