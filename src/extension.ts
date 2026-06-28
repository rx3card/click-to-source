// Entry point. Registers the command, creates the panel, and wires the messages
// coming from the page back to the resolver and the editor.

import * as vscode from 'vscode';
import { getWebviewHtml } from './webviewContent';
import { resolveCandidate } from './sourceResolver';
import { openAt, offerSearchFallback } from './editor';
import { InspectPayload } from './types';

let currentPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const openCmd = vscode.commands.registerCommand('clickToSource.open', () => {
    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.Beside);
      return;
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

    const devUrl = vscode.workspace
      .getConfiguration('clickToSource')
      .get<string>('devServerUrl', 'http://localhost:3000');

    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri, devUrl);

    panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.type === 'openFile') {
          await handleInspect(message.payload as InspectPayload);
        }
      },
      undefined,
      context.subscriptions
    );

    panel.onDidDispose(
      () => {
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
