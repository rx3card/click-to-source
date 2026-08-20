// @ts-check
// Panel script (host). Bridges the app iframe and the extension, keeps the user
// informed at every stage, and never leaves the panel silently blank: every
// failure mode ends in a visible message that says what happened and what to do.
//
// A note on the load strategy, because it is the whole reason this panel used to
// come up blank: the frame is loaded FIRST and questions are asked afterwards.
// Gating the iframe behind a "is the server up?" probe means any slow answer -
// and a cold Next.js/Turbopack build easily takes ten seconds - leaves the panel
// showing nothing. The proxy always answers a document request (your app when it
// is up, a self-refreshing waiting page when it is not), so pointing the frame at
// it immediately is both simpler and strictly more reliable.
(function () {
  const vscode = acquireVsCodeApi();
  // When the proxy is on, the iframe loads it (and it forwards to your dev
  // server, rewriting cookies and injecting the client). Empty = no proxy.
  const PROXY_URL = (window.__CTS && window.__CTS.proxyUrl) || '';

  const toggleBtn = /** @type {HTMLButtonElement} */ (document.getElementById('toggle'));
  const urlInput = /** @type {HTMLInputElement} */ (document.getElementById('url'));
  const reloadBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reload'));
  const openExternalBtn = /** @type {HTMLButtonElement} */ (document.getElementById('openExternal'));
  const statusEl = /** @type {HTMLElement} */ (document.getElementById('status'));
  const iframe = /** @type {HTMLIFrameElement} */ (document.getElementById('app'));
  const emptyEl = /** @type {HTMLElement} */ (document.getElementById('empty'));
  const emptyMsg = /** @type {HTMLElement} */ (document.getElementById('empty-msg'));
  const retryBtn = /** @type {HTMLButtonElement} */ (document.getElementById('retry'));
  const bannerEl = /** @type {HTMLElement} */ (document.getElementById('banner'));
  const bannerMsg = /** @type {HTMLElement} */ (document.getElementById('banner-msg'));
  const bannerClose = /** @type {HTMLButtonElement} */ (document.getElementById('banner-close'));

  let inspecting = false;
  let clientReady = false;
  let clientHintTimer = null;
  let retryTimer = null;
  let watchdogTimer = null;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function showBanner(text) {
    bannerMsg.textContent = text;
    bannerEl.hidden = false;
  }

  function hideBanner() {
    bannerEl.hidden = true;
  }

  function postToApp(message) {
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage(message, '*');
    }
  }

  function setInspecting(value) {
    inspecting = value;
    toggleBtn.textContent = value ? 'Selector: ON' : 'Selector: OFF';
    toggleBtn.classList.toggle('active', value);
    postToApp({ source: 'click-to-source-host', type: 'toggle', enabled: value });
    setStatus(value ? 'Hover and click an element...' : '');

    // If the client script never announced itself, clicking would silently do
    // nothing; tell the user what is going on instead.
    clearTimeout(clientHintTimer);
    if (value && !clientReady) {
      clientHintTimer = setTimeout(() => {
        if (inspecting && !clientReady) {
          setStatus('Selector needs the inspector client. Enable the clickToSource.proxy setting, then Reload.');
        }
      }, 1500);
    }
  }

  function portOf(url) {
    try {
      const u = new URL(url);
      return u.port || (u.protocol === 'https:' ? '443' : '80');
    } catch (e) {
      return '';
    }
  }

  // Keeps whatever path the user typed, so "localhost:3000/dashboard" opens the
  // dashboard through the proxy instead of silently falling back to the root.
  function pathOf(url) {
    try {
      const u = new URL(url);
      const path = u.pathname === '/' ? '' : u.pathname;
      return path + (u.search || '');
    } catch (e) {
      return '';
    }
  }

  function showEmpty(url, detail) {
    const port = portOf(url);
    emptyMsg.textContent =
      "It looks like there's no server running at " +
      url +
      (port ? ' (port ' + port + ')' : '') +
      (detail ? ' - ' + detail : '') +
      '. Make sure your app is started and the URL is correct. Retrying automatically...';
    emptyEl.hidden = false;
  }

  function hideEmpty() {
    emptyEl.hidden = true;
  }

  function showFrame(frameUrl) {
    hideEmpty();
    hideBanner();
    // Force a reload even if the URL is unchanged.
    iframe.src = 'about:blank';
    setTimeout(() => {
      iframe.src = frameUrl;
    }, 0);
  }

  function scheduleRetry(url) {
    clearTimeout(retryTimer);
    // Keep checking quietly and load as soon as the server comes up, so
    // "start the app, see it appear" needs no clicks.
    retryTimer = setTimeout(() => loadUrl(url, true), 3000);
  }

  // Loads the preview. With the proxy on, the frame is pointed at the proxy
  // straight away and the health endpoint is consulted only to describe what is
  // happening in the status line - it never decides whether to show the page.
  // Without the proxy there is nothing to serve a waiting page, so the old
  // check-then-load path is kept.
  function loadUrl(url, silent) {
    if (!url) {
      return;
    }
    clearTimeout(retryTimer);
    // Keep the proxy's WebSocket forwarding on the right target too.
    vscode.postMessage({ type: 'setTarget', url: url });

    if (PROXY_URL) {
      showFrame(PROXY_URL + pathOf(url));
      setStatus('Loading ' + url + '...');
      // Purely informational: says "still starting" instead of leaving the user
      // to guess why the waiting page is showing.
      fetch(PROXY_URL + '/__click-to-source-health?target=' + encodeURIComponent(url) + '&t=' + Date.now(), {
        cache: 'no-store'
      })
        .then((r) => r.json())
        .then((health) => {
          if (health && !health.ok) {
            setStatus('Waiting for ' + url + ' (' + (health.error || 'not answering') + ')...');
          }
        })
        .catch(() => {
          // The proxy itself is unreachable; fall back to loading directly so
          // the panel still works, and say so.
          showFrame(url);
          showBanner(
            'The helper proxy is not responding, so the page was loaded directly. ' +
              'The selector is unavailable and apps that send anti-framing headers may show a blank page. ' +
              'Close and reopen the panel to restart the proxy.'
          );
        });
      return;
    }

    if (!silent) {
      setStatus('Checking ' + url + '...');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch(url, { mode: 'no-cors', signal: controller.signal })
      .then(() => {
        clearTimeout(timer);
        showFrame(url);
        setStatus('');
      })
      .catch(() => {
        clearTimeout(timer);
        iframe.src = 'about:blank';
        showEmpty(url);
        setStatus('');
        scheduleRetry(url);
      });
  }

  toggleBtn.addEventListener('click', () => setInspecting(!inspecting));
  reloadBtn.addEventListener('click', () => loadUrl(urlInput.value.trim()));
  openExternalBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'openExternal', url: urlInput.value.trim() });
  });
  retryBtn.addEventListener('click', () => loadUrl(urlInput.value.trim()));
  bannerClose.addEventListener('click', hideBanner);
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      loadUrl(urlInput.value.trim());
    }
  });

  // True only for the blank placeholder we navigate through on purpose. A real
  // page is cross-origin, so reading its location throws - and that throw is
  // exactly the signal that something real is loaded. Without this check the
  // placeholder's own load event re-armed the watchdog after the client had
  // already reported in, which is what produced a warning banner on a page that
  // was working perfectly.
  function isBlankPlaceholder() {
    try {
      return !iframe.contentWindow || iframe.contentWindow.location.href === 'about:blank';
    } catch (e) {
      return false;
    }
  }

  // Whenever the page finishes loading (first load, Reload, or in-app
  // navigation), push the current selector state so it stays in sync without
  // the user having to reload manually. Also arm a watchdog: when the proxy is
  // on, the inspector client is always injected, so if it never says "ready"
  // something real is wrong and the user deserves to know - a blank panel with
  // no explanation is the one outcome this panel must never produce.
  iframe.addEventListener('load', () => {
    clearTimeout(watchdogTimer);
    if (isBlankPlaceholder()) {
      return;
    }
    clientReady = false;
    postToApp({ source: 'click-to-source-host', type: 'toggle', enabled: inspecting });
    // Ask the client to identify itself. It announces itself once, on install,
    // which for a fast page happens before this load event - so without asking
    // again we would forget a client that is right there and warn about it.
    postToApp({ source: 'click-to-source-host', type: 'ping' });

    watchdogTimer = setTimeout(() => {
      if (clientReady) {
        return;
      }
      if (PROXY_URL) {
        showBanner(
          'The page loaded, but the inspector client has not started, so the selector will not work. ' +
            'Press Reload. If this keeps happening, your app may be serving HTML the proxy cannot inject into - ' +
            'please report it at github.com/rx3card/click-to-source/issues.'
        );
      } else {
        showBanner(
          'Running without the helper proxy: the selector is unavailable, and apps that send ' +
            'X-Frame-Options or CSP frame-ancestors headers (most Next.js apps with security headers) ' +
            'render as a blank page. Enable the clickToSource.proxy setting, then reopen the panel.'
        );
      }
    }, 7000);
  });

  // Messages coming from the client script inside the iframe (your app).
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'click-to-source-client') {
      return;
    }

    if (data.type === 'inspect') {
      vscode.postMessage({ type: 'openFile', payload: data.payload });
      const label = data.payload && data.payload.meta && (data.payload.meta.label || data.payload.meta.tag);
      setStatus(label ? 'Opening ' + label : 'Opening...');
    } else if (data.type === 'ready') {
      clientReady = true;
      clearTimeout(watchdogTimer);
      hideBanner();
      setStatus('Client connected');
      postToApp({ source: 'click-to-source-host', type: 'toggle', enabled: inspecting });
    } else if (data.type === 'waiting') {
      // The proxy's waiting room, not your app: it refreshes itself every few
      // seconds, so there is nothing wrong and no warning to give.
      clearTimeout(watchdogTimer);
      clientReady = false;
    }
  });

  // Initial load: check the configured URL.
  loadUrl(urlInput.value.trim());
})();
