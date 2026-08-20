// A small local proxy that sits between the panel iframe and your dev server.
//
// It exists to make the in-VS-Code preview behave like a normal browser tab for
// any project, with zero per-project setup:
//
//   1. Framing: many apps (and most Next.js starters with security headers) send
//      X-Frame-Options or a CSP with frame-ancestors, which makes the browser
//      silently refuse to render the page inside the panel's iframe. The proxy
//      removes those directives so the preview always renders. Note that a CSP
//      of `frame-ancestors 'self'` is not enough for the panel: the webview runs
//      on the vscode-webview: origin, so it is never "self".
//   2. Cookies: the panel embeds your app in a cross-origin iframe, where the
//      browser treats SameSite=Strict/Lax session cookies as third-party and
//      drops them (logging you out). The proxy rewrites every Set-Cookie to
//      SameSite=None; Secure so the session survives.
//   3. Origin checks: Next.js 15+ blocks /_next/* requests whose Origin does not
//      match the dev server (allowedDevOrigins). The proxy rewrites Origin and
//      Referer so the dev server sees itself as the caller.
//   4. Client script: it injects the inspector client into every HTML response,
//      so you don't have to copy any file into your project.
//   5. Waiting room: when the dev server is not up yet, a document request gets
//      a self-refreshing "waiting" page instead of a dead frame, so the panel is
//      never blank and the app appears on its own once the server starts.
//
// The iframe loads this proxy; the proxy forwards to your real dev server.

import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as zlib from 'zlib';
import httpProxy from 'http-proxy';

export interface ProxyHandle {
  url: string;
  setTarget(target: string): void;
  dispose(): void;
}

const CLIENT_PATH = '/__click-to-source-client.js';
const HEALTH_PATH = '/__click-to-source-health';

// Headers that describe a single hop and must never be copied to the next one.
// Forwarding `connection: close` in particular makes the browser tear down and
// redial a socket for every asset, which is slow and flaky on a dev server that
// serves hundreds of chunks.
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
];

// Only these encodings can be safely decoded before injecting the client. An
// encoding we don't understand (zstd on older Node, or a chain like "gzip, br")
// means the body must be left completely alone: rewriting it would ship
// compressed bytes labelled as text, which renders as a blank page.
type Decoder = (buf: Buffer) => Buffer;
const DECODERS: Record<string, Decoder> = {
  '': (buf) => buf,
  identity: (buf) => buf,
  gzip: (buf) => zlib.gunzipSync(buf),
  'x-gzip': (buf) => zlib.gunzipSync(buf),
  deflate: (buf) => zlib.inflateSync(buf),
  br: (buf) => zlib.brotliDecompressSync(buf)
};
const zstdDecompressSync = (zlib as unknown as { zstdDecompressSync?: Decoder }).zstdDecompressSync;
if (typeof zstdDecompressSync === 'function') {
  DECODERS.zstd = (buf) => zstdDecompressSync(buf);
}

export async function startProxy(
  clientScriptFsPath: string,
  initialTarget: string
): Promise<ProxyHandle> {
  let target = toOrigin(initialTarget);
  let proxyOrigin = '';
  const clientScript = safeRead(clientScriptFsPath);

  const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    ws: true,
    // Dev servers often run https with self-signed certs; never fail on that.
    secure: false,
    selfHandleResponse: true
  });

  // The dev server must see itself as the caller: Next.js 15+ rejects /_next/*
  // requests from unknown origins, and CSRF checks compare Origin/Referer
  // against Host. Also ask for an uncompressed body so HTML can be injected.
  //
  // These are built up front and handed to proxy.web/proxy.ws through the
  // `headers` option, NOT set on the ClientRequest afterwards. http-proxy emits
  // proxyReq from inside the request's own `socket` event, by which point Node
  // has already flushed the headers, so setHeader() there throws
  // ERR_HTTP_HEADERS_SENT - uncaught, inside an emitter, killing the request
  // before it ever reaches the dev server and leaving the panel blank.
  const requestHeaders = (req: http.IncomingMessage): { [header: string]: string } => {
    const headers: { [header: string]: string } = { 'accept-encoding': 'identity' };
    for (const name of ['origin', 'referer'] as const) {
      const value = req.headers[name];
      if (typeof value === 'string' && proxyOrigin && value.startsWith(proxyOrigin)) {
        headers[name] = value.replace(proxyOrigin, target);
      }
    }
    return headers;
  };

  // Belt and braces: if anything still reaches the request after it was
  // committed, a failed header rewrite must never take the whole request down.
  const rewriteRequest = (proxyReq: http.ClientRequest) => {
    if (proxyReq.headersSent || proxyReq.destroyed) {
      return;
    }
    try {
      proxyReq.setHeader('accept-encoding', 'identity');
    } catch {
      /* already committed; the headers option above covered this */
    }
  };
  proxy.on('proxyReq', rewriteRequest);
  proxy.on('proxyReqWs', rewriteRequest);

  proxy.on('proxyRes', (proxyRes, _req, res) => {
    const headers: http.OutgoingHttpHeaders = { ...proxyRes.headers };

    // The upstream body is already de-chunked by Node's HTTP client, and
    // per-hop headers belong to the upstream connection only. Node re-applies
    // framing on its own when we pipe or send a buffer.
    for (const name of HOP_BY_HOP) {
      delete headers[name];
    }

    // 1) Let the page render inside the panel's iframe. Without this, apps that
    // send X-Frame-Options or CSP frame-ancestors show up as a blank frame.
    delete headers['x-frame-options'];
    for (const name of ['content-security-policy', 'content-security-policy-report-only']) {
      const csp = headers[name];
      if (typeof csp === 'string') {
        const sanitized = stripFrameAncestors(csp);
        if (sanitized) {
          headers[name] = sanitized;
        } else {
          delete headers[name];
        }
      } else if (Array.isArray(csp)) {
        headers[name] = csp.map(stripFrameAncestors).filter(Boolean);
      }
    }

    // 2) Keep session cookies alive inside the cross-origin iframe.
    const setCookie = proxyRes.headers['set-cookie'];
    if (setCookie) {
      headers['set-cookie'] = (Array.isArray(setCookie) ? setCookie : [setCookie]).map(rewriteCookie);
    }

    // 3) Keep redirects pointed at the proxy, not the real dev server.
    const location = proxyRes.headers['location'];
    if (typeof location === 'string') {
      headers['location'] = location.split(target).join(proxyOrigin);
    }

    // The browser often aborts requests when the panel reloads. Guard every
    // write so a dead response never throws "Cannot set headers after sent".
    const writable = () => !res.headersSent && !res.writableEnded && !res.destroyed;
    const status = proxyRes.statusCode || 200;

    // Streams the upstream body through untouched. Used for every response that
    // must not be rewritten: non-HTML, bodiless statuses, and any HTML whose
    // encoding cannot be safely decoded.
    const passThrough = () => {
      if (!writable()) {
        proxyRes.destroy();
        return;
      }
      try {
        res.writeHead(status, headers);
        proxyRes.pipe(res);
      } catch {
        proxyRes.destroy();
      }
    };

    const contentType = String(proxyRes.headers['content-type'] || '');
    // 304/204/205 carry no body: injecting one would produce a response whose
    // content-length lies about a body the browser must not read.
    const bodiless = status === 204 || status === 205 || status === 304;
    if (bodiless || !contentType.includes('text/html')) {
      passThrough();
      return;
    }

    // 4) HTML: buffer, inject the client script, resend.
    const chunks: Buffer[] = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk as Buffer));
    proxyRes.on('error', () => {
      /* upstream aborted; nothing to send */
    });
    proxyRes.on('end', () => {
      if (!writable()) {
        return;
      }
      // We ask for identity, but some servers compress anyway.
      const raw = Buffer.concat(chunks);
      const encoding = String(proxyRes.headers['content-encoding'] || '')
        .trim()
        .toLowerCase();
      const decoder = DECODERS[encoding];
      let decoded: Buffer | null = null;
      if (decoder) {
        try {
          decoded = decoder(raw);
        } catch {
          decoded = null;
        }
      }

      // An encoding we cannot decode (or that fails to decode) means the body
      // must go out exactly as it came in, headers included. Mangling it here is
      // what turns a working app into a blank page.
      if (!decoded) {
        try {
          res.writeHead(status, headers);
          res.end(raw);
        } catch {
          /* response already gone */
        }
        return;
      }

      let body = decoded.toString('utf8');
      delete headers['content-encoding'];

      // Reuse the page's script nonce (if any) so a strict script-src CSP does
      // not block the injected client.
      const nonceMatch = body.match(/<script[^>]*\snonce="([^"]+)"/i);
      const nonceAttr = nonceMatch ? ` nonce="${nonceMatch[1]}"` : '';
      const tag = `<script${nonceAttr} src="${CLIENT_PATH}"></script>`;
      if (/<\/body>/i.test(body)) {
        body = body.replace(/<\/body>/i, `${tag}</body>`);
      } else {
        body += tag;
      }
      const buf = Buffer.from(body, 'utf8');
      // We send a full buffer, so the length must describe what is actually sent.
      headers['content-length'] = String(buf.length);
      try {
        res.writeHead(status, headers);
        res.end(buf);
      } catch {
        /* response already gone */
      }
    });
  });

  proxy.on('error', (err, req, res) => {
    const r = res as http.ServerResponse;
    if (!r || typeof r.writeHead !== 'function' || r.headersSent || r.writableEnded || r.destroyed) {
      return;
    }
    const code = (err as NodeJS.ErrnoException).code || err.message;
    try {
      // A document request gets a real page instead of a dead frame, so the
      // panel is never blank and the app shows up by itself once the server is
      // running. Assets still get a plain 502.
      if (wantsHtml(req as http.IncomingMessage)) {
        const page = waitingPage(target, code);
        r.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': String(Buffer.byteLength(page))
        });
        r.end(page);
      } else {
        r.writeHead(502, { 'content-type': 'text/plain' });
        r.end('Click to Source proxy: the dev server did not respond (' + code + ').');
      }
    } catch {
      /* ignore */
    }
  });

  const server = http.createServer((req, res) => {
    // The panel asks here whether the dev server is up. Checking from Node
    // avoids every browser restriction (mixed content, CORS) that made the
    // webview's own fetch unreliable, especially for LAN addresses. The check
    // also (re)points the proxy at the requested target, so there is no race
    // between changing the URL and loading the page.
    if (req.url && req.url.startsWith(HEALTH_PATH)) {
      const requested = new URL(req.url, 'http://internal').searchParams.get('target');
      if (requested) {
        target = toOrigin(requested);
      }
      checkTarget(target).then((result) => {
        if (res.headersSent || res.writableEnded || res.destroyed) {
          return;
        }
        try {
          res.writeHead(200, {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'cache-control': 'no-store'
          });
          res.end(JSON.stringify(result));
        } catch {
          /* response already gone */
        }
      });
      return;
    }
    if (req.url === CLIENT_PATH) {
      // The browser can abort this while the panel reloads; never let a write
      // on a dead response throw "Cannot set headers after they are sent".
      if (res.headersSent || res.writableEnded || res.destroyed) {
        return;
      }
      try {
        res.writeHead(200, {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-store'
        });
        res.end(clientScript);
      } catch {
        /* response already gone */
      }
      return;
    }
    proxy.web(req, res, { target, headers: requestHeaders(req) });
  });

  // Proxy WebSocket upgrades too (dev servers use them for hot reload).
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {
      /* client went away; nothing to do */
    });
    proxy.ws(req, socket, head, { target, headers: requestHeaders(req) });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      proxyOrigin = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  return {
    url: proxyOrigin,
    setTarget(t: string) {
      target = toOrigin(t);
    },
    dispose() {
      try {
        server.close();
        proxy.close();
      } catch {
        /* ignore */
      }
    }
  };
}

/**
 * Answers one question only: is something listening on that host and port?
 *
 * It deliberately does not fetch a page. A dev server that is up but still
 * compiling (Next.js with Turbopack routinely needs ten seconds or more for the
 * first request) would fail a short HTTP probe, and every abandoned probe throws
 * away work the server had already done. A TCP connect answers instantly and
 * costs the dev server nothing; whether the page renders is the iframe's job.
 */
function checkTarget(origin: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      resolve({ ok: false, error: 'invalid target URL' });
      return;
    }
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    let settled = false;
    const done = (result: { ok: boolean; error?: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const socket = net.connect({ host: u.hostname, port });
    socket.setTimeout(2000);
    socket.on('connect', () => done({ ok: true }));
    socket.on('timeout', () => done({ ok: false, error: 'timed out' }));
    socket.on('error', (e: NodeJS.ErrnoException) => done({ ok: false, error: e.code || e.message }));
  });
}

/** True when the request is for a page, not for an asset or an XHR. */
function wantsHtml(req: http.IncomingMessage): boolean {
  const dest = String(req.headers['sec-fetch-dest'] || '');
  if (dest) {
    return dest === 'document' || dest === 'iframe';
  }
  return String(req.headers['accept'] || '').includes('text/html');
}

/** Shown inside the iframe while the dev server is not answering. */
function waitingPage(target: string, code: string): string {
  const safeTarget = escapeHtml(target);
  const safeCode = escapeHtml(code);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta http-equiv="refresh" content="3" />
<title>Waiting for ${safeTarget}</title>
<style>
  body { margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: system-ui, sans-serif; background: #1e1e1e; color: #dddddd;
    text-align: center; padding: 24px; }
  .card { max-width: 420px; }
  h1 { font-size: 19px; margin: 0 0 12px; }
  p { font-size: 13px; line-height: 1.6; opacity: 0.8; margin: 6px 0; }
  code { background: #2b2b2b; padding: 2px 6px; border-radius: 4px; }
</style></head>
<body><div class="card">
  <h1>Waiting for your dev server</h1>
  <p>Nothing is answering at <code>${safeTarget}</code> yet (<code>${safeCode}</code>).</p>
  <p>Start it, and this page will load your app by itself.</p>
</div>
<script>
  // Tells the panel this is the waiting room, not your app, so its "the
  // inspector client never started" watchdog stays quiet while we wait.
  try { parent.postMessage({ source: 'click-to-source-client', type: 'waiting' }, '*'); } catch (e) {}
</script>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Removes the frame-ancestors directive but keeps the rest of the policy. */
function stripFrameAncestors(csp: string): string {
  return csp
    .split(';')
    .filter((directive) => !/^\s*frame-ancestors\b/i.test(directive))
    .join(';')
    .trim();
}

/** Normalizes a user-entered URL to its origin (scheme://host:port). */
function toOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    try {
      return new URL('http://' + url).origin;
    } catch {
      return url;
    }
  }
}

/** Rewrites a Set-Cookie so it survives the cross-origin iframe. */
function rewriteCookie(cookie: string): string {
  const cleaned = cookie
    .replace(/;\s*Domain=[^;]*/gi, '')
    .replace(/;\s*SameSite=[^;]*/gi, '')
    .replace(/;\s*Secure/gi, '');
  return `${cleaned}; SameSite=None; Secure`;
}

function safeRead(path: string): string {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
