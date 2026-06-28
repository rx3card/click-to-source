// Builds the HTML for the panel: a small toolbar plus an iframe that embeds your
// running app. The toolbar wraps gracefully on narrow widths so nothing breaks.

import * as vscode from 'vscode';

export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  devUrl: string
): string {
  const nonce = getNonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'webview.js')
  );

  const csp = [
    `default-src 'none'`,
    `frame-src http: https:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `connect-src http: https:`
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Click to Source</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden;
      font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
    body { display: flex; flex-direction: column; }
    #toolbar { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center;
      gap: 6px; padding: 6px 8px;
      background: var(--vscode-editorWidget-background);
      border-bottom: 1px solid var(--vscode-editorWidget-border); }
    #toolbar input { flex: 1 1 90px; min-width: 70px; padding: 4px 6px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; }
    button { flex: 0 0 auto; white-space: nowrap; padding: 4px 10px; cursor: pointer;
      border-radius: 4px; border: none;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.active { background: var(--vscode-statusBarItem-warningBackground); color: #000; }
    #status { flex: 1 1 100%; min-width: 0; font-size: 11px; opacity: 0.8;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #status:empty { display: none; }
    #frameWrap { flex: 1 1 auto; position: relative; min-height: 0; }
    iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; background: #fff; }
    #empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      padding: 24px; text-align: center; background: var(--vscode-editor-background); }
    #empty[hidden] { display: none; }
    .empty-card { max-width: 400px; }
    .empty-card h2 { margin: 0 0 10px; font-size: 20px; }
    .empty-card p { margin: 6px 0; font-size: 13px; line-height: 1.5; opacity: 0.85; }
    .empty-card .hint { opacity: 0.6; }
    .empty-card code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 4px; }
    #retry { margin-top: 14px; }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="toggle" title="Toggle the element selector">Selector: OFF</button>
    <button id="reload" title="Reload the page">Reload</button>
    <input id="url" value="${devUrl}" placeholder="http://localhost:3000" />
    <span id="status"></span>
  </div>
  <div id="frameWrap">
    <iframe id="app" src="about:blank"></iframe>
    <div id="empty" hidden>
      <div class="empty-card">
        <h2>Oops!</h2>
        <p id="empty-msg"></p>
        <p class="hint">Start your dev server, then press Retry.</p>
        <button id="retry">Retry</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
