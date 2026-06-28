// @ts-check
// Panel script (host). Bridges the app iframe and the extension, and shows a
// friendly message when no dev server is running at the given URL.
(function () {
  const vscode = acquireVsCodeApi();

  const toggleBtn = /** @type {HTMLButtonElement} */ (document.getElementById('toggle'));
  const urlInput = /** @type {HTMLInputElement} */ (document.getElementById('url'));
  const reloadBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reload'));
  const statusEl = /** @type {HTMLElement} */ (document.getElementById('status'));
  const iframe = /** @type {HTMLIFrameElement} */ (document.getElementById('app'));
  const emptyEl = /** @type {HTMLElement} */ (document.getElementById('empty'));
  const emptyMsg = /** @type {HTMLElement} */ (document.getElementById('empty-msg'));
  const retryBtn = /** @type {HTMLButtonElement} */ (document.getElementById('retry'));

  let inspecting = false;

  function setStatus(text) {
    statusEl.textContent = text;
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
  }

  function portOf(url) {
    try {
      const u = new URL(url);
      return u.port || (u.protocol === 'https:' ? '443' : '80');
    } catch (e) {
      return '';
    }
  }

  function showEmpty(url) {
    const port = portOf(url);
    emptyMsg.textContent =
      "It looks like there's no server running at " +
      url +
      (port ? ' (port ' + port + ')' : '') +
      '. Make sure your app is started and the URL is correct.';
    emptyEl.hidden = false;
  }

  function hideEmpty() {
    emptyEl.hidden = true;
  }

  // Checks whether a server answers at the URL, then loads it (or shows the
  // empty state). A no-cors fetch resolves if the server responds and rejects
  // on a connection error, which is exactly what we need to detect.
  function loadUrl(url) {
    if (!url) {
      return;
    }
    setStatus('Connecting to ' + url + '...');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    fetch(url, { mode: 'no-cors', signal: controller.signal })
      .then(() => {
        clearTimeout(timer);
        hideEmpty();
        // Force a reload even if the URL is unchanged.
        iframe.src = 'about:blank';
        setTimeout(() => {
          iframe.src = url;
        }, 0);
        setStatus('');
      })
      .catch(() => {
        clearTimeout(timer);
        iframe.src = 'about:blank';
        showEmpty(url);
        setStatus('');
      });
  }

  toggleBtn.addEventListener('click', () => setInspecting(!inspecting));
  reloadBtn.addEventListener('click', () => loadUrl(urlInput.value.trim()));
  retryBtn.addEventListener('click', () => loadUrl(urlInput.value.trim()));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      loadUrl(urlInput.value.trim());
    }
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
      setStatus('Client connected');
      postToApp({ source: 'click-to-source-host', type: 'toggle', enabled: inspecting });
    }
  });

  // Initial load: check the configured URL.
  loadUrl(urlInput.value.trim());
})();
