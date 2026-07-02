'use strict';

const fs = require('fs');

function readPort() {
    try {
        return fs.readFileSync('/tmp/cursor-browser-bridge-port', 'utf8').trim();
    } catch (_) {
        return '';
    }
}

function mockupPanelHtml() {
    const port = readPort();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src http://127.0.0.1:*;" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.4 var(--vscode-font-family, system-ui); color: var(--vscode-foreground, #ccc); background: var(--vscode-sideBar-background, #1e1e1e); }
  .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border, #444); background: var(--vscode-editor-background, #252526); }
  .tab { padding: 8px 12px; font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
  .tab.muted { opacity: 0.45; pointer-events: none; }
  .tab.active { color: var(--vscode-foreground, #fff); border-bottom: 2px solid var(--vscode-focusBorder, #ff6600); font-weight: 600; }
  .body { padding: 12px; }
  h3 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground, #888); }
  label { display: block; font-size: 11px; margin: 8px 0 4px; color: var(--vscode-descriptionForeground, #aaa); }
  input, select { width: 100%; padding: 6px 8px; margin-bottom: 4px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #eee); border: 1px solid var(--vscode-input-border, #555); border-radius: 4px; }
  button { width: 100%; margin: 4px 0; padding: 8px 10px; cursor: pointer; background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 4px; font-size: 12px; }
  button.secondary { background: var(--vscode-button-secondaryBackground, #3a3d41); }
  button.danger { background: #8b2e2e; }
  button:hover { filter: brightness(1.08); }
  #log { margin-top: 10px; padding: 8px; min-height: 48px; max-height: 120px; overflow: auto; font: 11px/1.35 monospace; background: var(--vscode-textCodeBlock-background, #2d2d2d); border-radius: 4px; white-space: pre-wrap; }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin: 8px 0; }
  ul.items { list-style: none; padding: 0; margin: 8px 0; max-height: 100px; overflow: auto; }
  ul.items li { padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border, #333); font-size: 11px; cursor: pointer; }
  ul.items li:hover { color: #ff6600; }
</style>
</head>
<body>
  <div class="tabs">
    <span class="tab muted">Components</span>
    <span class="tab muted">Design</span>
    <span class="tab muted">CSS</span>
    <span class="tab active">os1 Mockup</span>
  </div>
  <div class="body">
    <p class="hint">Controls the IDE browser tab. Open a page first (e.g. login live1).</p>
    <button id="btnEnable">Enable mockup mode</button>
    <button id="btnDisable" class="secondary">Disable mockup mode</button>
    <h3>Duplicate element</h3>
    <label>Target type</label>
    <select id="targetType">
      <option value="id">Element id</option>
      <option value="selector">CSS selector</option>
      <option value="cursorElementId">cursor-element-id</option>
    </select>
    <label>Value</label>
    <input id="targetValue" placeholder="result_app_6" />
    <label>Label (optional)</label>
    <input id="targetLabel" placeholder="Discuss (mockup)" />
    <button id="btnDuplicate">Duplicate</button>
    <h3>Image container</h3>
    <label>Image URL</label>
    <input id="imageUrl" placeholder="https://picsum.photos/640/360" />
    <label>Caption</label>
    <input id="imageLabel" placeholder="Hero mockup" />
    <button id="btnContainer">Add image container</button>
    <h3>On page</h3>
    <ul class="items" id="itemList"></ul>
    <button id="btnRefresh" class="secondary">Refresh list</button>
    <div id="log"></div>
  </div>
  <script>
    const PORT = ${JSON.stringify(port)};
    const logEl = document.getElementById('log');
    function log(msg) { logEl.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2); }
    async function api(method, path, body) {
      if (!PORT) { log('Bridge not running — reload Cursor'); return null; }
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch('http://127.0.0.1:' + PORT + path, opts);
      return r.json();
    }
    document.getElementById('btnEnable').onclick = async () => log(await api('POST', '/design/enable', {}));
    document.getElementById('btnDisable').onclick = async () => log(await api('POST', '/design/disable', {}));
    document.getElementById('btnDuplicate').onclick = async () => {
      const type = document.getElementById('targetType').value;
      const val = document.getElementById('targetValue').value.trim();
      if (!val) return log('Enter a target value');
      const body = { float: true, label: document.getElementById('targetLabel').value.trim() || undefined };
      body[type] = val;
      log(await api('POST', '/design/duplicate', body));
      refreshList();
    };
    document.getElementById('btnContainer').onclick = async () => {
      log(await api('POST', '/design/container', {
        imageUrl: document.getElementById('imageUrl').value.trim() || undefined,
        label: document.getElementById('imageLabel').value.trim() || undefined,
        width: 400, height: 240, left: 100, top: 100
      }));
      refreshList();
    };
    async function refreshList() {
      const data = await api('GET', '/design/list');
      const ul = document.getElementById('itemList');
      ul.innerHTML = '';
      (data && data.items || []).forEach(it => {
        const li = document.createElement('li');
        li.textContent = it.id + ' — ' + (it.text || it.tag).slice(0, 40);
        li.title = 'Click to remove';
        li.onclick = async () => { log(await api('POST', '/design/remove', { id: it.id })); refreshList(); };
        ul.appendChild(li);
      });
    }
    document.getElementById('btnRefresh').onclick = refreshList;
    refreshList();
  </script>
</body>
</html>`;
}

module.exports = { mockupPanelHtml };
