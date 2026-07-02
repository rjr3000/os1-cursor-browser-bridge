# os1 Cursor Browser Bridge

Control **Cursor IDE's embedded browser** from shell scripts via a local HTTP API — **no Agent**, no Playwright, no external Chromium.

Adapted from [VectorlyApp/cursor-browser-bridge](https://github.com/VectorlyApp/cursor-browser-bridge) with os1-specific agent-session handling, MCP-parity tools, REST shortcuts, and Odoo login.

## Why

Cursor's built-in browser (`cursor-ide-browser`) is wired to the Agent panel. This extension wraps Cursor's internal `cursor.browserView.*` commands as HTTP endpoints so terminal scripts and CI can drive the **same IDE browser tab**.

## Architecture

```
login live1  →  HTTP POST /odoo-login  →  extension.js  →  cursor.browserView.*  →  IDE browser tab
your-script  →  HTTP POST /tool        →  extension.js  →  cursor.browserView.*  →  IDE browser tab
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
# {"ok":true,"version":"0.3.0"}
```

## Uninstall

```bash
bash uninstall.sh
```

## HTTP API

### REST shortcuts

| Method | Path | Body / query | Description |
|--------|------|--------------|-------------|
| GET | `/health` | — | Health + version |
| GET | `/tools` | — | Tool schemas + route list |
| GET | `/tabs` | — | Open browser tabs |
| GET | `/snapshot` | `?viewId=&interactive=` | Accessibility snapshot |
| GET | `/url` | `?viewId=` | Current tab URL |
| GET | `/title` | `?viewId=` | Document title |
| POST | `/navigate` | `{ url, newTab?, viewId? }` | Navigate + snapshot |
| POST | `/close-tab` | `{ viewId }` | Close tab |
| POST | `/wait-for` | `{ host?, urlContains?, ref?, text?, timeoutMs?, viewId? }` | Poll until condition |
| POST | `/odoo-login` | `{ stack?, loginUrl?, publicUrl?, newTab?, credentials? }` | Full Odoo login flow |
| POST | `/design/enable` | `{ viewId? }` | Mockup mode — drag, orange outlines |
| POST | `/design/disable` | `{ viewId? }` | Turn off mockup mode |
| POST | `/design/duplicate` | `{ id\|ref\|selector\|cursorElementId\|domPath, label?, float? }` | Clone element (e.g. Odoo app tile) |
| POST | `/design/container` | `{ imageUrl?, label?, width?, height?, left?, top? }` | Draggable image block |
| GET | `/design/list` | `?viewId=` | List mockup elements |
| POST | `/design/remove` | `{ id, viewId? }` | Remove mockup element |
| POST | `/design/move` | `{ id, left, top, viewId? }` | Programmatic reposition |
| POST | `/register-script-session` | — | Create/discover `ownerAgentId` |
| POST | `/tool` | `{ name, args }` | Generic tool dispatch |
| GET | `/debug/tabs` | — | Tab list + agent id state |
| GET | `/debug/commands` | — | Cursor browser/agent command names |

### Tools (via `POST /tool`)

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate; returns snapshot + `viewId` |
| `browser_snapshot` | Accessibility snapshot with element refs |
| `browser_click` | Click by ref |
| `browser_fill` | Clear and fill input |
| `browser_type` | Append text |
| `browser_hover` | Hover element |
| `browser_press_key` | Keyboard key |
| `browser_scroll` | Scroll page/element (direction or delta) |
| `browser_select_option` | Select `<option>` values |
| `browser_drag` | Drag sourceRef → targetRef or xy |
| `browser_get_bounding_box` | Element rect by ref |
| `browser_highlight` | Orange outline briefly |
| `browser_mouse_click_xy` | Click viewport coordinates |
| `browser_cdp` | CDP command (Runtime.evaluate fallback) |
| `browser_screenshot` / `browser_take_screenshot` | PNG screenshot |
| `browser_tabs` | List tabs |
| `browser_lock` / `browser_unlock` | Tab lock |
| `browser_close_tab` | Close tab |
| `browser_navigate_back` / `browser_navigate_forward` | History |
| `browser_reload` | Reload page |
| `browser_console_messages` | Console log |
| `browser_network_requests` | Network log |
| `browser_resize` | Viewport size |
| `browser_evaluate` | Execute JavaScript |

**Important:** Pass `viewId` from navigate snapshot metadata on subsequent calls when multiple tabs are open.

### Examples

```bash
PORT=$(cat /tmp/cursor-browser-bridge-port)

# List tools
curl -s "http://127.0.0.1:${PORT}/tools" | jq '.tools | keys'

# Navigate
curl -s -X POST "http://127.0.0.1:${PORT}/navigate" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}'

# Odoo stack login (reads .cursor/browser-open-request.json if stack omitted)
curl -s -X POST "http://127.0.0.1:${PORT}/odoo-login" \
  -H 'Content-Type: application/json' \
  -d '{"stack":"live1"}'

# Generic tool
curl -s -X POST "http://127.0.0.1:${PORT}/tool" \
  -H 'Content-Type: application/json' \
  -d '{"name":"browser_snapshot","args":{"interactive":true}}'
```

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
