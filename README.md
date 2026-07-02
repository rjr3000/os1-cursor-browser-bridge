# os1 Cursor Browser Bridge

Control **Cursor IDE's embedded browser** from shell scripts via a local HTTP API — **no Agent**, no Playwright, no external Chromium.

Adapted from [VectorlyApp/cursor-browser-bridge](https://github.com/VectorlyApp/cursor-browser-bridge) with os1-specific agent-session handling and snapshot-ref login flows.

## Why

Cursor's built-in browser (`cursor-ide-browser`) is wired to the Agent panel. This extension wraps Cursor's internal `cursor.browserView.*` commands as HTTP endpoints so terminal scripts and CI can drive the **same IDE browser tab**.

## Architecture

```
your-script.sh  →  HTTP POST /tool  →  extension.js  →  cursor.browserView.*  →  IDE browser tab
```

Port file: `/tmp/cursor-browser-bridge-port`

## Requirements

- **Cursor IDE** (not VS Code alone)
- **Browser Automation** enabled: Settings → Tools & MCP → Browser Automation

## Install

```bash
git clone https://github.com/rjr3000/os1-cursor-browser-bridge.git
cd os1-cursor-browser-bridge
bash install.sh
```

Reload Cursor: **Ctrl+Shift+P → Developer: Reload Window**

Verify:

```bash
curl -s "http://127.0.0.1:$(cat /tmp/cursor-browser-bridge-port)/health"
# {"ok":true}
```

## Uninstall

```bash
bash uninstall.sh
```

## HTTP API

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ "ok": true }` |
| GET | `/debug/tabs` | — | tab list + agent id state |
| POST | `/register-script-session` | — | create/discover `ownerAgentId` |
| POST | `/tool` | `{ "name": "...", "args": { ... } }` | tool result |

### Tools

`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill`, `browser_type`, `browser_evaluate`, `browser_tabs`, `browser_screenshot`, `browser_lock`, `browser_unlock`, and more.

Example:

```bash
PORT=$(cat /tmp/cursor-browser-bridge-port)
curl -s -X POST "http://127.0.0.1:${PORT}/tool" \
  -H 'Content-Type: application/json' \
  -d '{"name":"browser_navigate","args":{"url":"https://example.com"}}'
```

**Important:** Pass `viewId` from navigate snapshot metadata on subsequent calls when multiple tabs are open.

## Palette commands

- **os1 Browser Bridge: Create Script Session** — register script `ownerAgentId` (required on newer Cursor builds)
- **os1 Browser Bridge: Capture Agent Context** — copy active Agent session id (fallback)

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `bridge not running` | Run `install.sh`, reload Cursor |
| `ownerAgentId` / HTTP 500 | Enable Browser Automation; run **Create Script Session** |
| `about:blank` after navigate | Reuse existing tab (`newTab: false`); pin `viewId` |
| Microsoft Store popup | Do not open `cursor://` deeplinks from terminal on Windows Remote SSH |

## os1 consumer

Used by [odoo-19-os1](https://github.com/rjr3000/odoo-19-os1) `login live1` via `x_cli/os1-stack-login-ide-browser.py`.

## License

MIT — see [LICENSE](LICENSE). Derived from VectorlyApp/cursor-browser-bridge.
