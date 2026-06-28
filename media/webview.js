// @ts-check
// Panel script (host). Bridges the app iframe and the extension.
(function () {
  const vscode = acquireVsCodeApi();

  const toggleBtn = /** @type {HTMLButtonElement} */ (document.getElementById('toggle'));
  const urlInput = /** @type {HTMLInputElement} */ (document.getElementById('url'));
  const reloadBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reload'));
  const statusEl = /** @type {HTMLElement} */ (document.getElementById('status'));
  const iframe = /** @type {HTMLIFrameElement} */ (document.getElementById('app'));

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

  toggleBtn.addEventListener('click', () => setInspecting(!inspecting));

  reloadBtn.addEventListener('click', () => {
    iframe.src = urlInput.value;
  });

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      iframe.src = urlInput.value;
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

  setStatus('Panel ready. Turn on the selector once your app loads.');
})();
