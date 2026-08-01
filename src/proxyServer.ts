// A small local proxy that sits between the panel iframe and your dev server.
//
// It exists to make the in-VS-Code preview behave like a normal browser tab for
// any project, with zero per-project setup:
//
//   1. Framing: many apps (and most Next.js starters with security headers) send
//      X-Frame-Options or a CSP with frame-ancestors, which makes the browser
//      silently refuse to render the page inside the panel's iframe. The proxy
//      removes those directives so the preview always renders.
//   2. Cookies: the panel embeds your app in a cross-origin iframe, where the
//      browser treats SameSite=Strict/Lax session cookies as third-party and
//      drops them (logging you out). The proxy rewrites every Set-Cookie to
//      SameSite=None; Secure so the session survives.
//   3. Origin checks: Next.js 15+ blocks /_next/* requests whose Origin does not
//      match the dev server (allowedDevOrigins). The proxy rewrites Origin and
//      Referer so the dev server sees itself as the caller.
//   4. Client script: it injects the inspector client into every HTML response,
//      so you don't have to copy any file into your project.
//
// The iframe loads this proxy; the proxy forwards to your real dev server.

import * as http from 'http';
import * as https from 'https';
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
  const rewriteRequest = (proxyReq: http.ClientRequest) => {
    proxyReq.setHeader('accept-encoding', 'identity');
    for (const name of ['origin', 'referer'] as const) {
      const value = proxyReq.getHeader(name);
      if (typeof value === 'string' && proxyOrigin && value.startsWith(proxyOrigin)) {
        proxyReq.setHeader(name, value.replace(proxyOrigin, target));
      }
    }
  };
  proxy.on('proxyReq', rewriteRequest);
  proxy.on('proxyReqWs', rewriteRequest);

  proxy.on('proxyRes', (proxyRes, _req, res) => {
    const headers: http.OutgoingHttpHeaders = { ...proxyRes.headers };

    // The upstream body is already de-chunked by Node's HTTP client, so we must
    // never forward the upstream transfer-encoding. Node re-applies framing on
    // its own when we pipe or send a buffer. Keeping it corrupts JS/CSS chunks
    // and leaves the page blank.
    delete headers['transfer-encoding'];

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

    const contentType = String(proxyRes.headers['content-type'] || '');
    if (!contentType.includes('text/html')) {
      if (!writable()) {
        proxyRes.destroy();
        return;
      }
      try {
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      } catch {
        proxyRes.destroy();
      }
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
      const encoding = String(proxyRes.headers['content-encoding'] || '').toLowerCase();
      let body: string;
      try {
        body = decompress(raw, encoding).toString('utf8');
        delete headers['content-encoding'];
      } catch {
        body = raw.toString('utf8');
      }

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
      // We send a full buffer, so replace any streaming/length headers.
      delete headers['transfer-encoding'];
      delete headers['content-length'];
      headers['content-length'] = String(buf.length);
      try {
        res.writeHead(proxyRes.statusCode || 200, headers);
        res.end(buf);
      } catch {
        /* response already gone */
      }
    });
  });

  proxy.on('error', (_err, _req, res) => {
    const r = res as http.ServerResponse;
    if (r && typeof r.writeHead === 'function' && !r.headersSent && !r.writableEnded && !r.destroyed) {
      try {
        r.writeHead(502, { 'content-type': 'text/plain' });
        r.end('Click to Source proxy: the dev server did not respond.');
      } catch {
        /* ignore */
      }
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
    proxy.web(req, res, { target });
  });

  // Proxy WebSocket upgrades too (dev servers use them for hot reload).
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {
      /* client went away; nothing to do */
    });
    proxy.ws(req, socket, head, { target });
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

/** Asks the dev server for anything at all, with a short timeout. */
function checkTarget(origin: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      resolve({ ok: false, error: 'invalid target URL' });
      return;
    }
    const get = u.protocol === 'https:' ? https.get : http.get;
    const req = get(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: '/',
        timeout: 3000,
        rejectUnauthorized: false
      },
      (r) => {
        r.destroy();
        resolve({ ok: true });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timed out' });
    });
    req.on('error', (e: NodeJS.ErrnoException) => {
      resolve({ ok: false, error: e.code || e.message });
    });
  });
}

/** Removes the frame-ancestors directive but keeps the rest of the policy. */
function stripFrameAncestors(csp: string): string {
  return csp
    .split(';')
    .filter((directive) => !/^\s*frame-ancestors\b/i.test(directive))
    .join(';')
    .trim();
}

function decompress(buf: Buffer, encoding: string): Buffer {
  switch (encoding) {
    case 'gzip':
      return zlib.gunzipSync(buf);
    case 'deflate':
      return zlib.inflateSync(buf);
    case 'br':
      return zlib.brotliDecompressSync(buf);
    default:
      return buf;
  }
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
