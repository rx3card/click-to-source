// Everything that touches the editor: opening a file at a line, briefly
// highlighting it, and the "couldn't find it, let's search instead" fallback.

import * as vscode from 'vscode';
import { InspectPayload, SignatureCandidate, Target } from './types';

export async function openAt(target: Target) {
  const uri = vscode.Uri.file(target.file);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false
  });

  const line = Math.min(Math.max(0, target.line - 1), Math.max(0, doc.lineCount - 1));
  const col = Math.max(0, target.column - 1);
  const pos = new vscode.Position(line, col);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

  const lineRange = doc.lineAt(line).range;
  const deco = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    isWholeLine: true
  });
  editor.setDecorations(deco, [lineRange]);
  setTimeout(() => deco.dispose(), 1500);
}

/** When no strategy resolves, never fail silently: offer a workspace search. */
export async function offerSearchFallback(payload: InspectPayload) {
  const label = payload.meta?.label || payload.meta?.tag || 'element';
  const sig = (payload.candidates || []).find((c) => c.kind === 'signature') as
    | SignatureCandidate
    | undefined;

  const query =
    (sig && sig.id) ||
    (sig && sig.text && sig.text.length >= 4 ? sig.text : undefined) ||
    (sig && sig.classes && sig.classes[0]) ||
    label;

  const choice = await vscode.window.showInformationMessage(
    `Click to Source: couldn't pinpoint the exact source for <${label}>. Search the workspace instead?`,
    'Search'
  );
  if (choice === 'Search' && query) {
    await vscode.commands.executeCommand('workbench.action.findInFiles', {
      query,
      triggerSearch: true,
      isRegex: false,
      isCaseSensitive: false
    });
  }
}
