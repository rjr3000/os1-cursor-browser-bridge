'use strict';

const { readPortFile } = require('./paths');

function readPort() {
    return readPortFile();
}

/** HTML for workspace panel (HTTP to remote bridge). */
function mockupPanelHtml() {
    const port = readPort();
    return mockupPanelHtmlWithPort(port);
}

function mockupPanelHtmlWithPort(port) {
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
  .tab.muted { opacity: 0.45; pointer-events: none; user-select: none; }
  .tab.active { color: var(--vscode-foreground, #fff); border-bottom: 2px solid #ff6600; font-weight: 600; }
  .body { padding: 12px; }
  h3 { margin: 12px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground, #888); }
  label { display: block; font-size: 11px; margin: 6px 0 4px; }
  input, select { width: 100%; padding: 6px 8px; margin-bottom: 4px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #eee); border: 1px solid var(--vscode-input-border, #555); border-radius: 4px; }
  button { width: 100%; margin: 4px 0; padding: 8px 10px; cursor: pointer; background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 4px; font-size: 12px; }
  button.secondary { background: var(--vscode-button-secondaryBackground, #3a3d41); }
  #log { margin-top: 10px; padding: 8px; min-height: 40px; max-height: 100px; overflow: auto; font: 11px/1.35 monospace; background: var(--vscode-textCodeBlock-background, #2d2d2d); border-radius: 4px; white-space: pre-wrap; }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-bottom: 10px; line-height: 1.4; }
  ul.items { list-style: none; padding: 0; margin: 8px 0; max-height: 90px; overflow: auto; }
  ul.items li { padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border, #333); font-size: 11px; cursor: pointer; }
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
    <p class="hint">Same row as Design/CSS — os1 Mockup tab. Controls the IDE browser page.</p>
    <button id="btnEnable">Enable mockup mode</button>
    <button id="btnDisable" class="secondary">Disable</button>
    <h3>Duplicate</h3>
    <select id="targetType"><option value="id">Element id</option><option value="selector">CSS selector</option><option value="cursorElementId">cursor-element-id</option></select>
    <input id="targetValue" placeholder="result_app_6" />
    <input id="targetLabel" placeholder="Label (optional)" />
    <button id="btnDuplicate">Duplicate</button>
    <button id="btnPick" class="secondary">Pick on page</button>
    <h3>Image block</h3>
    <input id="imageUrl" placeholder="Image URL" />
    <input id="imageLabel" placeholder="Caption" />
    <button id="btnContainer">Add container</button>
    <ul class="items" id="itemList"></ul>
    <button id="btnRefresh" class="secondary">Refresh list</button>
    <div id="log"></div>
  </div>
  <script>
    const PORT = ${JSON.stringify(port)};
    const logEl = document.getElementById('log');
    function log(msg) { logEl.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2); }
    async function api(method, path, body) {
      if (!PORT) { log('Bridge port missing — reload Cursor'); return null; }
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch('http://127.0.0.1:' + PORT + path, opts);
      return r.json();
    }
    document.getElementById('btnEnable').onclick = () => api('POST', '/design/enable', {}).then(log);
    document.getElementById('btnDisable').onclick = () => api('POST', '/design/disable', {}).then(log);
    document.getElementById('btnDuplicate').onclick = async () => {
      const body = { float: true, label: document.getElementById('targetLabel').value.trim() || undefined };
      body[document.getElementById('targetType').value] = document.getElementById('targetValue').value.trim();
      log(await api('POST', '/design/duplicate', body)); refreshList();
    };
    document.getElementById('btnPick').onclick = () => log('Use Pick in page panel after Enable, or enter id result_app_6');
    document.getElementById('btnContainer').onclick = async () => {
      log(await api('POST', '/design/container', {
        imageUrl: document.getElementById('imageUrl').value.trim() || undefined,
        label: document.getElementById('imageLabel').value.trim() || undefined,
        width: 400, height: 240
      })); refreshList();
    };
    async function refreshList() {
      const data = await api('GET', '/design/list');
      const ul = document.getElementById('itemList'); ul.innerHTML = '';
      (data && data.items || []).forEach(it => {
        const li = document.createElement('li');
        li.textContent = (it.text || it.tag).slice(0, 36);
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

module.exports = { mockupPanelHtml, mockupPanelHtmlWithPort };
