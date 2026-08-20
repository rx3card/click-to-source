# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[semantic versioning](https://semver.org/).

## [0.2.8] - 2026-08-20

### Fixed
- The panel came up blank inside the real VS Code webview, with the status stuck
  on "Loading...". The Extension Host log named the cause:
  `Cannot set headers after they are sent to the client`, thrown from
  `ClientRequest.setHeader` inside the request's own `socket` event.
  `http-proxy` emits `proxyReq` from that event, by which point Node has already
  flushed the request headers, so rewriting them there threw an uncaught error
  that killed the request before it ever reached the dev server - the dev server
  logged zero requests. Request headers are now supplied when the request is
  created, through the `headers` option of `proxy.web`/`proxy.ws`, and the old
  hook remains only as a guarded fallback.
- The watchdog is armed when navigation starts instead of on the iframe's `load`
  event. A navigation that fails outright never fires `load`, so the watchdog
  never ran and the panel showed a white rectangle with no explanation - the one
  outcome it is supposed to make impossible. After ten seconds without a page it
  now asks the proxy what it sees and states the reason: the dev server is not
  answering and its error, or the server is up and the request failed inside the
  proxy, with where to look.

## [0.2.7] - 2026-08-20

### Fixed
- Blank panel that never resolved. The panel refused to show the frame until a
  health probe answered, and that probe gave the dev server only 3 seconds to
  render `/`. A cold Next.js/Turbopack build was measured at 9.4s on a real
  project, so the probe timed out, the frame was forced back to `about:blank`,
  and the retry loop re-probed every 3 seconds forever - each abandoned probe
  throwing away the compile work the server had just done. The frame is now
  loaded first and the health endpoint only describes what is happening.
- The health check no longer fetches a page. It opens a TCP connection, which
  answers in milliseconds, cannot time out on a slow first build, and costs the
  dev server nothing.
- Corrupted responses turning into a blank page. A `content-encoding` the proxy
  could not decode (`zstd`, or a chain such as `gzip, br`) had its header
  stripped while the body stayed compressed, and a decode failure kept the header
  while the body was mangled through a UTF-8 round trip. Bodies that cannot be
  safely decoded are now passed through byte for byte, headers included.
- `304`, `204` and `205` responses no longer get a script tag and a
  `content-length` describing a body the browser must not read.
- Hop-by-hop headers (`connection`, `keep-alive`, `upgrade`, ...) are no longer
  copied from the dev server, so the browser stops redialling a socket per asset.
- A path in `clickToSource.devServerUrl` is no longer discarded:
  `localhost:3000/dashboard` opens the dashboard instead of the site root.
- The "the inspector client has not started" warning no longer appears on a page
  that works. The client announces itself once, often before the panel's load
  handler runs, so the panel now asks it to identify itself and the client
  answers.

### Added
- A waiting page. When nothing answers, document requests get a self-refreshing
  page that names the address and the error, and the app appears on its own once
  the server is up - no clicking Retry, and never an unexplained blank frame.
- Remote support. The proxy address is resolved through `vscode.env.asExternalUri`,
  so the preview also works over Remote SSH, WSL, dev containers and Codespaces,
  where the webview runs on a different machine than the extension and a bare
  `127.0.0.1` pointed at the wrong computer.

## [0.2.6] - 2026-07-31

### Added
- The panel can no longer fail silently. Every failure mode now produces a
  visible explanation with a next step:
  - A health endpoint on the proxy checks the dev server from Node, immune to
    the browser rules (mixed content, CORS) that made the panel's own check
    unreliable for LAN addresses like 192.168.x.x.
  - If the page loads but the inspector client never starts, a banner explains
    why the selector will not work and what to do.
  - If the proxy is disabled or fails to start, the panel and a VS Code
    notification say so, including the consequence (blank page for apps with
    anti-framing headers) and the fix.
  - The "no server running" message now includes the concrete network error
    (for example ECONNREFUSED) and keeps retrying automatically.

## [0.2.5] - 2026-07-31

### Fixed
- Blank panel with Next.js (and any app that sends security headers): the proxy
  now removes `X-Frame-Options` and the CSP `frame-ancestors` directive, which
  made the browser silently refuse to render the page inside the panel's
  iframe. The rest of the app's CSP is preserved.
- Next.js 15/16 dev-origin protection: the proxy rewrites `Origin` and
  `Referer` to the dev server's own origin, so `/_next/*` assets and hot-reload
  requests are no longer rejected (no `allowedDevOrigins` config needed).
- HTML responses that arrive compressed (gzip/deflate/brotli) are now
  decompressed before the inspector client is injected, instead of being
  corrupted.
- The injected client script now reuses the page's CSP nonce when one exists,
  so strict `script-src` policies do not block it.
- HTTPS dev servers with self-signed certificates are accepted.

### Changed
- The proxy is ON by default again. It is the piece that makes the preview
  render everywhere; without it, apps with anti-framing headers show a blank
  panel. Direct loading remains the automatic fallback if the proxy cannot
  start.
- When no server answers, the panel now retries quietly every few seconds and
  loads the app as soon as it comes up - no clicks needed.
- If the selector is toggled on but the inspector client is not present (proxy
  disabled), the panel now says so instead of doing nothing.

## [0.2.4] - 2026-06-28

### Changed
- The cookie/injection proxy is now OFF by default. The panel loads your dev
  server directly (the most reliable path, like earlier versions). Enable
  clickToSource.proxy only if you need to stay logged in inside the panel.

## [0.2.3] - 2026-06-28

### Fixed
- Guard the injected-client route too, so an aborted request during a panel
  reload can never throw "Cannot set headers after they are sent".

## [0.2.2] - 2026-06-28

### Fixed
- No more "Cannot set headers after they are sent" errors: proxy responses are
  now guarded so aborted requests (from panel reloads) never crash the handler.

## [0.2.1] - 2026-06-28

### Fixed
- Blank page when the proxy was on: the upstream `transfer-encoding: chunked`
  header was forwarded on already-decoded JS/CSS responses, corrupting them.
  The header is now dropped so assets load correctly.

## [0.2.0] - 2026-06-28

### Added
- A built-in local proxy (on by default, `clickToSource.proxy`) so any project
  works inside the panel with no setup:
  - It rewrites session cookies to SameSite=None; Secure, so logging in inside
    the panel persists instead of kicking you back to the login page.
  - It injects the inspector client into HTML automatically, so you no longer
    have to copy a script into each project.
- An "Open in browser" button in the panel toolbar, useful as a fallback for
  pages behind a login.

## [0.1.1] - 2026-06-28

### Added
- A clear "no server running" message in the panel when nothing answers at the
  configured URL, with a Retry button, instead of a blank white screen.

### Fixed
- The selector now stays in sync after the page (re)loads, so toggling it on or
  off applies immediately without needing a manual reload.

## [0.1.0] - 2026-06-28

The first working release.

### Added
- A panel that embeds your running dev server inside VS Code.
- A status bar button to open the panel in one click, without the Command Palette.
- An element selector: hover to highlight, click to jump to the source file.
- React / Next.js support (React 19) by reading debug stacks and resolving them
  through Turbopack and webpack source maps to the original `.tsx`/`.jsx` line.
- Support for explicit source attributes (`data-inspector-*`, `data-source`).
- Vue single-file component detection.
- A DOM-fingerprint fallback that locates elements in plain HTML and in
  server-rendered templates (Flask, Django, PHP, EJS, Handlebars, and more).
- A graceful "search the workspace" fallback when an element can't be pinpointed.
- A configurable dev server URL (`clickToSource.devServerUrl`).
