// @ts-check
// Panel script (host). Bridges the app iframe and the extension, keeps the user
// informed at every stage, and never leaves the panel silently blank: every
// failure mode ends in a visible message that says what happened and what to do.
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
    setStatus('');
  }

  function scheduleRetry(url) {
    clearTimeout(retryTimer);
    // Keep checking quietly and load as soon as the server comes up, so
    // "start the app, see it appear" needs no clicks.
    retryTimer = setTimeout(() => loadUrl(url, true), 3000);
  }

  // Decides whether the dev server is reachable, then loads it (or shows the
  // empty state). With the proxy on, the check runs inside the proxy's Node
  // process, immune to the browser's mixed-content and CORS rules (which can
  // fail for LAN addresses even when the server is fine). Without the proxy, a
  // no-cors fetch is the best available signal.
  function loadUrl(url, silent) {
    if (!url) {
      return;
    }
    clearTimeout(retryTimer);
    // Keep the proxy's WebSocket forwarding on the right target too.
    vscode.postMessage({ type: 'setTarget', url: url });

    if (!silent) {
      setStatus('Checking ' + url + '...');
    }

    if (PROXY_URL) {
      const healthUrl =
        PROXY_URL + '/__click-to-source-health?target=' + encodeURIComponent(url) + '&t=' + Date.now();
      fetch(healthUrl, { cache: 'no-store' })
        .then((r) => r.json())
        .then((health) => {
          if (health && health.ok) {
            showFrame(PROXY_URL);
          } else {
            iframe.src = 'about:blank';
            showEmpty(url, health && health.error);
            setStatus('');
            scheduleRetry(url);
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch(url, { mode: 'no-cors', signal: controller.signal })
      .then(() => {
        clearTimeout(timer);
        showFrame(url);
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

  // Whenever the page finishes loading (first load, Reload, or in-app
  // navigation), push the current selector state so it stays in sync without
  // the user having to reload manually. Also arm a watchdog: when the proxy is
  // on, the inspector client is always injected, so if it never says "ready"
  // something real is wrong and the user deserves to know - a blank panel with
  // no explanation is the one outcome this panel must never produce.
  iframe.addEventListener('load', () => {
    clientReady = false;
    postToApp({ source: 'click-to-source-host', type: 'toggle', enabled: inspecting });

    clearTimeout(watchdogTimer);
    let src = '';
    try {
      src = iframe.src || '';
    } catch (e) {
      /* ignore */
    }
    if (!src || src === 'about:blank') {
      return;
    }
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
    }
  });

  // Initial load: check the configured URL.
  loadUrl(urlInput.value.trim());
})();
