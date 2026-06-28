/**
 * Click to Source - client script
 * --------------------------------------
 * Include this ONLY in development. It detects the source location of a clicked
 * element and sends it to the VS Code panel, which opens the file at that line.
 *
 * It tries several strategies, from most to least precise, and sends them all as
 * ordered candidates. The extension picks the first that resolves to real code:
 *   1. Explicit source attributes (data-inspector-* / data-source / data-loc)
 *   2. React 19 / Next fibers (_debugStack) + source maps
 *   3. Vue single-file component (__file)
 *   4. DOM signature (id / classes / text) to locate plain HTML or templates
 */
(function () {
  if (window.__clickToSourceInstalled) {
    return;
  }
  window.__clickToSourceInstalled = true;

  var enabled = false;
  var overlay = null;
  var lastTarget = null;

  function send(message) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        Object.assign({ source: 'click-to-source-client' }, message),
        '*'
      );
    }
  }

  /* ---------- React ---------- */

  function getFiberFromNode(node) {
    for (var key in node) {
      if (key.indexOf('__reactFiber$') === 0 || key.indexOf('__reactInternalInstance$') === 0) {
        return node[key];
      }
    }
    return null;
  }

  function collectFrames(stack) {
    var frames = [];
    if (!stack) {
      return frames;
    }
    var lines = stack.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf('at ') !== 0) {
        continue;
      }
      var name = null;
      var url = null;
      var m = line.match(/^at (.+?) \((.+)\)$/);
      if (m) {
        name = m[1];
        url = m[2];
      } else {
        var m2 = line.match(/^at (.+)$/);
        if (!m2) {
          continue;
        }
        url = m2[1];
      }
      if (/react-server-dom|react-dom|fakeJSXCallSite|react_stack_bottom_frame/.test(url)) {
        continue;
      }
      var lc = url.match(/:(\d+):(\d+)$/);
      if (!lc) {
        continue;
      }
      var lineNo = parseInt(lc[1], 10);
      var colNo = parseInt(lc[2], 10);
      var ref = url.slice(0, lc.index);
      var kind;
      if (ref.indexOf('about://React/Server/') === 0) {
        kind = 'server';
        ref = ref.slice('about://React/Server/'.length).replace(/\?\d+$/, '');
        ref = decodeURIComponent(ref);
      } else if (ref.indexOf('/_next/static/chunks/') !== -1) {
        kind = 'client';
        try {
          ref = new URL(ref).pathname;
        } catch (e) {
          /* keep ref */
        }
      } else {
        continue;
      }
      frames.push({ kind: kind, ref: ref, line: lineNo, column: colNo, name: name });
      if (frames.length >= 12) {
        break;
      }
    }
    return frames;
  }

  function getReactOwnerName(fiber) {
    var cur = fiber;
    var guard = 0;
    while (cur && guard < 50) {
      if (cur._debugOwner && cur._debugOwner.name) {
        return cur._debugOwner.name;
      }
      if (typeof cur.type === 'function' && (cur.type.displayName || cur.type.name)) {
        return cur.type.displayName || cur.type.name;
      }
      cur = cur.return;
      guard++;
    }
    return null;
  }

  function getReactFrames(node) {
    var fiber = getFiberFromNode(node);
    if (!fiber) {
      return null;
    }
    var frames = [];
    var seen = {};
    var cur = fiber;
    var guard = 0;
    while (cur && guard < 30 && frames.length < 24) {
      if (cur._debugStack && cur._debugStack.stack) {
        var batch = collectFrames(cur._debugStack.stack);
        for (var i = 0; i < batch.length; i++) {
          var fr = batch[i];
          var key = fr.kind + '|' + fr.ref + '|' + fr.line + '|' + fr.column;
          if (!seen[key]) {
            seen[key] = true;
            frames.push(fr);
          }
        }
      }
      cur = cur.return;
      guard++;
    }
    if (frames.length === 0) {
      return null;
    }
    return { frames: frames, ownerName: getReactOwnerName(fiber) };
  }

  /* ---------- Explicit source attributes ---------- */

  function getExplicitFile(node) {
    var el = node;
    for (var i = 0; i < 12 && el; i++) {
      if (el.getAttribute) {
        var rel = el.getAttribute('data-inspector-relative-path');
        if (rel) {
          return {
            file: rel,
            line: parseInt(el.getAttribute('data-inspector-line'), 10) || 1,
            column: parseInt(el.getAttribute('data-inspector-column'), 10) || 1
          };
        }
        var ds =
          el.getAttribute('data-source') ||
          el.getAttribute('data-loc') ||
          el.getAttribute('data-source-loc');
        if (ds) {
          var m = ds.match(/^(.*?):(\d+):(\d+)$/) || ds.match(/^(.*?):(\d+)$/);
          if (m) {
            return { file: m[1], line: parseInt(m[2], 10) || 1, column: m[3] ? parseInt(m[3], 10) : 1 };
          }
          return { file: ds, line: 1, column: 1 };
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  /* ---------- Vue ---------- */

  function getVueFile(node) {
    var el = node;
    for (var i = 0; i < 20 && el; i++) {
      var vc = el.__vueParentComponent; // Vue 3
      var g = 0;
      while (vc && g < 50) {
        if (vc.type && vc.type.__file) {
          return { file: vc.type.__file, line: 1, column: 1 };
        }
        vc = vc.parent;
        g++;
      }
      if (el.__vue__ && el.__vue__.$options && el.__vue__.$options.__file) { // Vue 2
        return { file: el.__vue__.$options.__file, line: 1, column: 1 };
      }
      el = el.parentElement;
    }
    return null;
  }

  /* ---------- DOM signature (plain HTML / templates) ---------- */

  function getSignature(node) {
    var classes = [];
    if (node.className && typeof node.className === 'string') {
      classes = node.className.trim().split(/\s+/).filter(Boolean).slice(0, 8);
    }
    var attrs = {};
    ['name', 'href', 'src', 'type', 'role', 'aria-label', 'data-testid', 'alt', 'placeholder'].forEach(
      function (a) {
        var v = node.getAttribute && node.getAttribute(a);
        if (v) {
          attrs[a] = v;
        }
      }
    );
    var openTag = '';
    if (node.outerHTML) {
      var end = node.outerHTML.indexOf('>');
      openTag = end >= 0 ? node.outerHTML.slice(0, end + 1) : node.outerHTML.slice(0, 200);
    }
    var text = (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return {
      tag: node.tagName ? node.tagName.toLowerCase() : '',
      id: node.id || null,
      classes: classes,
      attrs: attrs,
      openTag: openTag,
      text: text
    };
  }

  /* ---------- Build candidates ---------- */

  function buildPayload(node) {
    var candidates = [];

    var explicit = getExplicitFile(node);
    if (explicit) {
      candidates.push({ kind: 'file', file: explicit.file, line: explicit.line, column: explicit.column });
    }

    var react = getReactFrames(node);
    if (react) {
      candidates.push({ kind: 'frames', frames: react.frames });
    }

    var vue = getVueFile(node);
    if (vue) {
      candidates.push({ kind: 'file', file: vue.file, line: vue.line, column: vue.column });
    }

    var sig = getSignature(node);
    candidates.push(Object.assign({ kind: 'signature' }, sig));

    var label = (react && react.ownerName) || (vue && fileBase(vue.file)) || sig.tag;
    return { meta: { tag: sig.tag, label: label }, candidates: candidates };
  }

  function fileBase(p) {
    return String(p).split(/[\\/]/).pop();
  }

  /* ---------- Overlay ---------- */

  function ensureOverlay() {
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.zIndex = '2147483647';
    overlay.style.pointerEvents = 'none';
    overlay.style.background = 'rgba(80, 140, 255, 0.25)';
    overlay.style.border = '1px solid rgba(80, 140, 255, 0.9)';
    overlay.style.borderRadius = '2px';
    overlay.style.display = 'none';

    var label = document.createElement('div');
    label.style.position = 'absolute';
    label.style.top = '-20px';
    label.style.left = '0';
    label.style.font = '11px/16px monospace';
    label.style.background = 'rgba(80, 140, 255, 0.95)';
    label.style.color = '#fff';
    label.style.padding = '1px 6px';
    label.style.borderRadius = '3px';
    label.style.whiteSpace = 'nowrap';
    overlay.appendChild(label);
    overlay._label = label;

    document.body.appendChild(overlay);
    return overlay;
  }

  function labelFor(node) {
    var fiber = getFiberFromNode(node);
    var name = fiber ? getReactOwnerName(fiber) : null;
    if (!name) {
      var vue = getVueFile(node);
      if (vue) {
        name = fileBase(vue.file);
      }
    }
    var tag = node.tagName ? node.tagName.toLowerCase() : '';
    return name ? name + ' (' + tag + ')' : tag;
  }

  function highlight(node) {
    var ov = ensureOverlay();
    var rect = node.getBoundingClientRect();
    ov.style.display = 'block';
    ov.style.top = rect.top + 'px';
    ov.style.left = rect.left + 'px';
    ov.style.width = rect.width + 'px';
    ov.style.height = rect.height + 'px';
    ov._label.textContent = labelFor(node);
  }

  function hideOverlay() {
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  /* ---------- Handlers ---------- */

  function onMouseMove(e) {
    if (!enabled) {
      return;
    }
    var target = e.target;
    if (target === lastTarget || target === overlay) {
      return;
    }
    lastTarget = target;
    highlight(target);
  }

  function onClick(e) {
    if (!enabled) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    send({ type: 'inspect', payload: buildPayload(e.target) });
  }

  function onKeyDown(e) {
    if (enabled && e.key === 'Escape') {
      setEnabled(false);
    }
  }

  function setEnabled(value) {
    enabled = value;
    if (!enabled) {
      hideOverlay();
      lastTarget = null;
      document.body.style.cursor = '';
    } else {
      document.body.style.cursor = 'crosshair';
    }
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.source !== 'click-to-source-host') {
      return;
    }
    if (data.type === 'toggle') {
      setEnabled(!!data.enabled);
    }
  });

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', hideOverlay, true);

  send({ type: 'ready' });
  console.log('[Click to Source] client ready.');
})();
