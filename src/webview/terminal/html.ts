export interface TerminalHtmlParams {
  readonly cspSource: string;
  readonly nonce: string;
  readonly scriptUri: string;
  readonly renderer?: "webgl" | "dom";
}

export function renderTerminalHtml({
  cspSource,
  nonce,
  scriptUri,
  renderer = "webgl",
}: TerminalHtmlParams): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ULW Terminal</title>
  </head>
  <body>
    <div id="terminal-container" aria-label="ULW terminal"></div>
    <script nonce="${nonce}">window.__ulwRenderer=${JSON.stringify(renderer)};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
