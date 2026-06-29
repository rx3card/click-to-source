// A small local proxy that sits between the panel iframe and your dev server.
//
// It exists to make the in-VS-Code preview behave like a normal browser tab for
// any project, with zero per-project setup:
//
//   1. Cookies: the panel embeds your app in a cross-origin iframe, where the
//      browser treats SameSite=Strict/Lax session cookies as third-party and
//      drops them (logging you out). The proxy rewrites every Set-Cookie to
//      SameSite=None; Secure so the session survives.
//   2. Client script: it injects the inspector client into every HTML response,
//      so you don't have to copy any file into your project.
//
// The iframe loads this proxy; the proxy forwards to your real dev server.

import * as http from 'http';
import * as fs from 'fs';
import httpProxy from 'http-proxy';

export interface ProxyHandle {
  url: string;
  setTarget(target: string): void;
  dispose(): void;
}

const CLIENT_PATH = '/__click-to-source-client.js';

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
    selfHandleResponse: true
  });

  // Ask the dev server for uncompressed responses so we can inject into HTML.
  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.setHeader('accept-encoding', 'identity');
  });

  proxy.on('proxyRes', (proxyRes, _req, res) => {
    const headers: http.OutgoingHttpHeaders = { ...proxyRes.headers };

    // 1) Keep session cookies alive inside the cross-origin iframe.
    const setCookie = proxyRes.headers['set-cookie'];
    if (setCookie) {
      headers['set-cookie'] = (Array.isArray(setCookie) ? setCookie : [setCookie]).map(rewriteCookie);
    }

    // 2) Keep redirects pointed at the proxy, not the real dev server.
    const location = proxyRes.headers['location'];
    if (typeof location === 'string') {
      headers['location'] = location.split(target).join(proxyOrigin);
    }

    const contentType = String(proxyRes.headers['content-type'] || '');
    if (!contentType.includes('text/html')) {
      res.writeHead(proxyRes.statusCode || 200, headers);
      proxyRes.pipe(res);
      return;
    }

    // 3) HTML: buffer, inject the client script, resend.
    const chunks: Buffer[] = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk as Buffer));
    proxyRes.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      const tag = `<script src="${CLIENT_PATH}"></script>`;
      if (body.includes('</body>')) {
        body = body.replace('</body>', `${tag}</body>`);
      } else {
        body += tag;
      }
      const buf = Buffer.from(body, 'utf8');
      // We send a full buffer, so replace any streaming/length headers from the
      // upstream. Keeping both transfer-encoding and content-length is invalid.
      delete headers['transfer-encoding'];
      delete headers['content-length'];
      headers['content-length'] = String(buf.length);
      res.writeHead(proxyRes.statusCode || 200, headers);
      res.end(buf);
    });
  });

  proxy.on('error', (_err, _req, res) => {
    const r = res as http.ServerResponse;
    if (r && typeof r.writeHead === 'function' && !r.headersSent) {
      try {
        r.writeHead(502, { 'content-type': 'text/plain' });
        r.end('Click to Source proxy: the dev server did not respond.');
      } catch {
        /* ignore */
      }
    }
  });

  const server = http.createServer((req, res) => {
    if (req.url === CLIENT_PATH) {
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store'
      });
      res.end(clientScript);
      return;
    }
    proxy.web(req, res, { target });
  });

  // Proxy WebSocket upgrades too (dev servers use them for hot reload).
  server.on('upgrade', (req, socket, head) => {
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
