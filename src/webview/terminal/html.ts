import {
  renderTerminalContainer,
  type TerminalContainerParams,
} from "./terminal-container";
import { renderTmuxPrompt } from "./tmux-prompt-template";
import { renderTmuxToolbar } from "./tmux-toolbar";

export interface TerminalHtmlParams extends TerminalContainerParams {
  cspSource: string;
  nonce: string;
  cssUri: string;
  scriptUri: string;
}

export function renderTerminalHtml({
  cspSource,
  nonce,
  cssUri,
  scriptUri,
  fontSize,
  fontFamily,
  cursorBlink,
  cursorStyle,
  scrollback,
  sendKeybindingsToShell,
  renderer,
  showTmuxWindowControls,
}: TerminalHtmlParams): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ULW Terminal</title>
    <link rel="stylesheet" href="${cssUri}" />
  </head>
  <body>
    ${renderTmuxToolbar(showTmuxWindowControls !== "false")}
    ${renderTerminalContainer({
      fontSize,
      fontFamily,
      cursorBlink,
      cursorStyle,
      scrollback,
      sendKeybindingsToShell,
      renderer,
    })}
    ${renderTmuxPrompt()}
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
