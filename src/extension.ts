// Entry point. Registers the command, creates the panel, and wires the messages
// coming from the page back to the resolver and the editor.

import * as vscode from 'vscode';
import { getWebviewHtml } from './webviewContent';
import { resolveCandidate } from './sourceResolver';
import { openAt, offerSearchFallback } from './editor';
import { startProxy, ProxyHandle } from './proxyServer';
import { InspectPayload } from './types';

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const openCmd = vscode.commands.registerCommand('clickToSource.open', async () => {
    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const config = vscode.workspace.getConfiguration('clickToSource');
    const devUrl = config.get<string>('devServerUrl', 'http://localhost:3000');
    const useProxy = config.get<boolean>('proxy', true);

    // The proxy keeps session cookies alive and auto-injects the client script,
    // so any project works with no setup. If it can't start, fall back to
    // loading the dev server directly.
    let proxy: ProxyHandle | undefined;
    if (useProxy) {
      try {
        const clientPath = vscode.Uri.joinPath(
          context.extensionUri,
          'media',
          'inspector-client.js'
        ).fsPath;
        proxy = await startProxy(clientPath, devUrl);
      } catch (err) {
        console.error('Click to Source: proxy failed to start, loading directly', err);
      }
    }

    const panel = vscode.window.createWebviewPanel(
      'clickToSource',
      'Click to Source',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    currentPanel = panel;

    // Icon shown on the panel's editor tab.
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.png');

    panel.webview.html = getWebviewHtml(
      panel.webview,
      context.extensionUri,
      devUrl,
      proxy?.url ?? ''
    );

    panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.type === 'openFile') {
          await handleInspect(message.payload as InspectPayload);
        } else if (message.type === 'setTarget' && typeof message.url === 'string') {
          proxy?.setTarget(message.url);
        } else if (message.type === 'openExternal' && typeof message.url === 'string') {
          try {
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
          } catch {
            /* ignore invalid URL */
          }
        }
      },
      undefined,
      context.subscriptions
    );

    panel.onDidDispose(
      () => {
        proxy?.dispose();
        currentPanel = undefined;
      },
      null,
      context.subscriptions
    );
  });

  context.subscriptions.push(openCmd);

  // A clickable item in the status bar so the panel is one click away, with no
  // need to go through the Command Palette. Status bar icons are monochrome and
  // follow the theme, so we use a built-in codicon that matches the others.
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.text = '$(target) Click to Source';
  statusItem.tooltip = 'Open the Click to Source panel';
  statusItem.command = 'clickToSource.open';
  statusItem.show();
  context.subscriptions.push(statusItem);
}

/** Tries each candidate strategy in order; opens the first that resolves. */
async function handleInspect(payload: InspectPayload) {
  if (!payload || !payload.candidates || payload.candidates.length === 0) {
    return;
  }

  for (const candidate of payload.candidates) {
    try {
      const target = await resolveCandidate(candidate);
      if (target) {
        await openAt(target);
        return;
      }
    } catch (err) {
      console.error('Click to Source: candidate failed', err);
    }
  }

  await offerSearchFallback(payload);
}

export function deactivate() {
  /* nothing to clean up */
}
