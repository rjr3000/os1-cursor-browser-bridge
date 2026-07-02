'use strict';

function mockupPanelUiHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.4 var(--vscode-font-family, system-ui); color: var(--vscode-foreground, #ccc); background: var(--vscode-sideBar-background, #1e1e1e); }
  .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border, #444); background: var(--vscode-editor-background, #252526); flex-shrink: 0; }
  .tab { padding: 8px 12px; font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
  .tab.muted { opacity: 0.45; pointer-events: none; user-select: none; }
  .tab.active { color: var(--vscode-foreground, #fff); border-bottom: 2px solid #ff6600; font-weight: 600; }
  .body { padding: 12px; overflow: auto; height: calc(100vh - 40px); }
  h3 { margin: 12px 0 6px; font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground, #888); }
  input, select { width: 100%; padding: 6px 8px; margin-bottom: 4px; background: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #eee); border: 1px solid var(--vscode-input-border, #555); border-radius: 4px; }
  button { width: 100%; margin: 4px 0; padding: 8px; cursor: pointer; background: var(--vscode-button-background, #0e639c); color: #fff; border: none; border-radius: 4px; }
  button.secondary { background: var(--vscode-button-secondaryBackground, #3a3d41); }
  #log { margin-top: 8px; padding: 6px; font: 11px monospace; background: var(--vscode-textCodeBlock-background, #2d2d2d); border-radius: 4px; max-height: 80px; overflow: auto; white-space: pre-wrap; }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-bottom: 8px; }
  ul.items { list-style: none; padding: 0; margin: 0; max-height: 80px; overflow: auto; }
  ul.items li { padding: 4px 0; font-size: 11px; cursor: pointer; border-bottom: 1px solid #333; }
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
    <p class="hint">UI extension — dock this panel beside the browser (Secondary Side Bar).</p>
    <button data-cmd="enable">Enable mockup mode</button>
    <button data-cmd="disable" class="secondary">Disable</button>
    <h3>Duplicate</h3>
    <select id="targetType"><option value="id">Element id</option><option value="selector">CSS selector</option><option value="cursorElementId">cursor-element-id</option></select>
    <input id="targetValue" placeholder="result_app_6" />
    <input id="targetLabel" placeholder="Label" />
    <button data-cmd="duplicate">Duplicate</button>
    <h3>Image</h3>
    <input id="imageUrl" placeholder="Image URL" />
    <input id="imageLabel" placeholder="Caption" />
    <button data-cmd="container">Add container</button>
    <ul class="items" id="itemList"></ul>
    <button data-cmd="refresh" class="secondary">Refresh</button>
    <div id="log"></div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const logEl = document.getElementById('log');
    function log(m) { logEl.textContent = typeof m === 'string' ? m : JSON.stringify(m, null, 2); }
    document.querySelectorAll('button[data-cmd]').forEach(btn => {
      btn.onclick = () => {
        const cmd = btn.getAttribute('data-cmd');
        const msg = { cmd };
        if (cmd === 'duplicate') {
          msg.type = document.getElementById('targetType').value;
          msg.value = document.getElementById('targetValue').value.trim();
          msg.label = document.getElementById('targetLabel').value.trim();
        }
        if (cmd === 'container') {
          msg.imageUrl = document.getElementById('imageUrl').value.trim();
          msg.label = document.getElementById('imageLabel').value.trim();
        }
        vscode.postMessage(msg);
      };
    });
    window.addEventListener('message', e => {
      const d = e.data;
      if (d.log) log(d.log);
      if (d.items) {
        const ul = document.getElementById('itemList');
        ul.innerHTML = '';
        d.items.forEach(it => {
          const li = document.createElement('li');
          li.textContent = (it.text || it.tag || it.id).slice(0, 40);
          li.onclick = () => vscode.postMessage({ cmd: 'remove', id: it.id });
          ul.appendChild(li);
        });
      }
    });
    vscode.postMessage({ cmd: 'refresh' });
  </script>
</body>
</html>`;
}

module.exports = { mockupPanelUiHtml };
