// Turns a clicked element's candidates into a real position in the user's code.
//
// Each candidate is a different strategy. We try them in order and return the
// first one that points at a file the user actually owns. The heavy lifting is
// the source-map step: a clicked DOM node reports a position inside a compiled
// bundle chunk, and we translate that back to the original .tsx/.jsx line.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SourceMapConsumer } from 'source-map';
import {
  Candidate,
  CompiledFrame,
  FileCandidate,
  SignatureCandidate,
  Target
} from './types';

export async function resolveCandidate(candidate: Candidate): Promise<Target | undefined> {
  switch (candidate.kind) {
    case 'frames':
      return resolveFrames(candidate.frames);
    case 'file':
      return resolveFile(candidate);
    case 'signature':
      return locateBySignature(candidate);
    default:
      return undefined;
  }
}

export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/* ------------------------------------------------------------------ */
/* Strategy 1: React frames resolved through source maps               */
/* ------------------------------------------------------------------ */

async function resolveFrames(frames: CompiledFrame[]): Promise<Target | undefined> {
  for (const frame of frames) {
    const resolved = await resolveViaSourceMap(frame);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

async function resolveViaSourceMap(frame: CompiledFrame): Promise<Target | undefined> {
  const compiledPath = compiledRefToDiskPath(frame.kind, frame.ref);
  if (!compiledPath || !fs.existsSync(compiledPath)) {
    return undefined;
  }

  const mapPath = findMapPath(compiledPath);
  if (!mapPath || !fs.existsSync(mapPath)) {
    return undefined;
  }

  const rawMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const consumer = await new SourceMapConsumer(rawMap);
  try {
    const orig = consumer.originalPositionFor({
      line: frame.line,
      column: frame.column ?? 0,
      bias: SourceMapConsumer.GREATEST_LOWER_BOUND
    });
    if (!orig || !orig.source) {
      return undefined;
    }
    const file = normalizeSourcePath(orig.source, mapPath);
    if (!file || !isUserSource(file)) {
      return undefined;
    }
    return { file, line: orig.line ?? 1, column: (orig.column ?? 0) + 1 };
  } finally {
    const anyConsumer = consumer as unknown as { destroy?: () => void };
    if (typeof anyConsumer.destroy === 'function') {
      anyConsumer.destroy();
    }
  }
}

/** Keeps only files that belong to the user (not dependencies or build output). */
function isUserSource(file: string): boolean {
  const norm = file.replace(/\\/g, '/');
  if (/\/node_modules\//.test(norm) || /\/\.next\//.test(norm)) {
    return false;
  }
  const root = getWorkspaceRoot();
  if (root && !norm.toLowerCase().startsWith(root.replace(/\\/g, '/').toLowerCase())) {
    return false;
  }
  return true;
}

function compiledRefToDiskPath(kind: string | undefined, ref: string): string | undefined {
  if (kind === 'server') {
    return ref;
  }
  const root = getWorkspaceRoot();
  if (!root) {
    return undefined;
  }
  const rel = ref.replace(/^\//, '');
  const candidates = [
    path.join(root, rel.replace(/^_next\//, '.next/dev/')),
    path.join(root, rel.replace(/^_next\//, '.next/'))
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function findMapPath(compiledPath: string): string | undefined {
  const sibling = compiledPath + '.map';
  if (fs.existsSync(sibling)) {
    return sibling;
  }
  try {
    const content = fs.readFileSync(compiledPath, 'utf8');
    const m = content.match(/sourceMappingURL=(\S+)\s*$/m);
    if (m) {
      const url = decodeURIComponent(m[1].trim());
      if (url.startsWith('data:')) {
        return undefined;
      }
      return path.resolve(path.dirname(compiledPath), url);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function normalizeSourcePath(source: string, mapPath: string): string | undefined {
  let s = source;
  if (s.startsWith('file://')) {
    try {
      return vscode.Uri.parse(s).fsPath;
    } catch {
      /* continue */
    }
  }
  s = s.replace(/^webpack:\/\/(_N_E\/)?/, '');
  s = s.replace(/^turbopack:\/\/(\[project\]\/)?/, '');
  s = s.replace(/^\.\//, '');

  if (path.isAbsolute(s) && fs.existsSync(s)) {
    return s;
  }
  const root = getWorkspaceRoot();
  if (root) {
    const candidate = path.join(root, s);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  const rel = path.resolve(path.dirname(mapPath), s);
  return fs.existsSync(rel) ? rel : undefined;
}

/* ------------------------------------------------------------------ */
/* Strategy 2: a file path we already know                             */
/* ------------------------------------------------------------------ */

function resolveFile(candidate: FileCandidate): Target | undefined {
  let file = candidate.file;
  if (file.startsWith('file://')) {
    try {
      file = vscode.Uri.parse(file).fsPath;
    } catch {
      /* keep raw */
    }
  }
  const resolved = resolveFilePath(file);
  if (!resolved) {
    return undefined;
  }
  return { file: resolved, line: candidate.line ?? 1, column: candidate.column ?? 1 };
}

function resolveFilePath(fileName: string): string | undefined {
  if (path.isAbsolute(fileName) && fs.existsSync(fileName)) {
    return fileName;
  }
  const root = getWorkspaceRoot();
  if (root) {
    const candidate = path.join(root, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return fs.existsSync(fileName) ? fileName : undefined;
}

/* ------------------------------------------------------------------ */
/* Strategy 3: locate the element by its DOM fingerprint               */
/* ------------------------------------------------------------------ */

async function locateBySignature(sig: SignatureCandidate): Promise<Target | undefined> {
  const needles = buildSearchNeedles(sig);
  if (needles.length === 0) {
    return undefined;
  }

  const files = await vscode.workspace.findFiles(
    '**/*.{html,htm,xhtml,vue,svelte,astro,jsx,tsx,ejs,erb,hbs,handlebars,mustache,php,twig,blade.php,njk,nunjucks,jinja,jinja2,j2,liquid}',
    '{**/node_modules/**,**/.next/**,**/dist/**,**/build/**,**/.git/**}',
    800
  );

  for (const needle of needles) {
    for (const uri of files) {
      try {
        const text = (await vscode.workspace.fs.readFile(uri)).toString();
        const idx = text.indexOf(needle);
        if (idx >= 0) {
          const line = text.slice(0, idx).split(/\r?\n/).length;
          return { file: uri.fsPath, line, column: 1 };
        }
      } catch {
        /* ignore unreadable files */
      }
    }
  }
  return undefined;
}

/** Search strings ordered from most to least unique. */
function buildSearchNeedles(sig: SignatureCandidate): string[] {
  const needles: string[] = [];
  if (sig.id) {
    needles.push(`id="${sig.id}"`, `id='${sig.id}'`);
  }
  if (sig.classes && sig.classes.length > 0) {
    const cls = sig.classes.join(' ');
    if (cls.length >= 6) {
      needles.push(`"${cls}"`, `'${cls}'`);
    }
    const longest = [...sig.classes].sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 6) {
      needles.push(longest);
    }
  }
  if (sig.attrs) {
    for (const key of ['data-testid', 'aria-label', 'name', 'href', 'src', 'alt', 'placeholder']) {
      const v = sig.attrs[key];
      if (v && v.length >= 3) {
        needles.push(`${key}="${v}"`);
      }
    }
  }
  if (sig.text && sig.text.length >= 4) {
    needles.push(sig.text);
  }
  return needles;
}
