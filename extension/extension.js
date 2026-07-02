/**
 * Cursor Browser Bridge Extension
 *
 * Exposes cursor.browserView.* commands as an HTTP API so that any MCP client
 * (Claude Code, etc.) can control Cursor's embedded Simple Browser.
 *
 * Architecture:
 *   MCP client ←stdio→ mcp-bridge.js ←HTTP→ this extension ←commands→ cursor.browserView.*
 *
 * The extension runs as a workspace extension (extensionKind: ["workspace"]).
 * VS Code/Cursor transparently proxies cursor.browserView.* commands from the
 * remote workspace host to the local UI host where the browser lives.
 */
const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT_FILE = '/tmp/cursor-browser-bridge-port';
const SCRIPT_AGENT_ID = 'os1-browser-bridge-script';
const AGENT_ID_BASENAME = 'browser-bridge-agent-id';

/** @type {vscode.ExtensionContext | null} */
let extensionContext = null;
/** Cached owner agent id from registration or capture. */
let cachedOwnerAgentId = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspaceAgentIdFile() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? path.join(root, '.cursor', AGENT_ID_BASENAME) : null;
}

function persistOwnerAgentId(id, source) {
    if (!id) return;
    cachedOwnerAgentId = id;
    extensionContext?.globalState.update('ownerAgentId', id);
    const file = workspaceAgentIdFile();
    if (file) {
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `${id}\n`, 'utf8');
        } catch (_) { /* ignore */ }
    }
    extensionOutput?.appendLine(`[Bridge] ownerAgentId=${id} (${source})`);
}

function loadPersistedOwnerAgentId() {
    if (cachedOwnerAgentId) return cachedOwnerAgentId;
    const fromState = extensionContext?.globalState.get('ownerAgentId');
    if (typeof fromState === 'string' && fromState) {
        cachedOwnerAgentId = fromState;
        return cachedOwnerAgentId;
    }
    const file = workspaceAgentIdFile();
    if (file && fs.existsSync(file)) {
        const id = fs.readFileSync(file, 'utf8').trim();
        if (id) {
            cachedOwnerAgentId = id;
            return cachedOwnerAgentId;
        }
    }
    return null;
}

/** @type {vscode.OutputChannel | null} */
let extensionOutput = null;

/** Raw listTabs payload (includes headlessTabs, ownerAgentId when present). */
async function listTabsInfo() {
    return vscode.commands.executeCommand('cursor.browserView.listTabs');
}

async function discoverOwnerAgentId() {
    const probes = [
        'cursor.browserView.getActiveOwnerAgentId',
        'cursor.browserView.getOwnerAgentId',
        'cursor.browserAutomation.getActiveOwnerAgentId',
        'cursor.browserAutomation.getOwnerAgentId',
        'cursor.agent.getCurrentAgentId',
        'cursor.agent.getActiveAgentId',
        'cursor.composer.getActiveComposerId',
        'cursor.composer.getFocusedComposerId',
        'cursor.chat.getActiveAgentId',
    ];
    for (const cmd of probes) {
        try {
            const result = await vscode.commands.executeCommand(cmd);
            if (typeof result === 'string' && result.trim()) return result.trim();
            if (result?.ownerAgentId) return result.ownerAgentId;
            if (result?.agentId) return result.agentId;
            if (result?.id) return result.id;
        } catch (_) { /* missing command */ }
    }
    const info = await listTabsInfo();
    for (const key of ['ownerAgentId', 'activeOwnerAgentId', 'lastOwnerAgentId']) {
        if (info?.[key]) return info[key];
    }
    if (info?.tabOwners && typeof info.tabOwners === 'object') {
        const first = Object.values(info.tabOwners).find(Boolean);
        if (first) return first;
    }
    return null;
}

async function registerScriptOwnerAgent() {
    const registerCmds = [
        ['cursor.browserView.createScriptOwnerAgent', SCRIPT_AGENT_ID],
        ['cursor.browserView.registerScriptOwnerAgent', SCRIPT_AGENT_ID],
        ['cursor.browserView.ensureScriptAgent', SCRIPT_AGENT_ID],
        ['cursor.browserView.registerScriptAgent', SCRIPT_AGENT_ID],
        ['cursor.browserAutomation.createScriptOwnerAgent', SCRIPT_AGENT_ID],
        ['cursor.browserAutomation.ensureScriptAgent', SCRIPT_AGENT_ID],
        ['cursor.browserAutomation.registerScriptOwnerAgent', { id: SCRIPT_AGENT_ID, name: 'os1-browser-bridge' }],
        ['cursor.browserAutomation.registerScriptOwnerAgent', SCRIPT_AGENT_ID],
    ];
    for (const [cmd, arg] of registerCmds) {
        try {
            const result = await vscode.commands.executeCommand(cmd, arg);
            if (typeof result === 'string' && result.trim()) return result.trim();
            if (result?.ownerAgentId) return result.ownerAgentId;
            if (result?.agentId) return result.agentId;
            if (result === true) return SCRIPT_AGENT_ID;
        } catch (_) { /* missing command */ }
    }
    return null;
}

async function ensureScriptAgentContext() {
    loadPersistedOwnerAgentId();
    if (cachedOwnerAgentId) return cachedOwnerAgentId;

    let id = await registerScriptOwnerAgent();
    if (id) {
        persistOwnerAgentId(id, 'registerScriptOwnerAgent');
        return id;
    }

    id = await discoverOwnerAgentId();
    if (id) {
        persistOwnerAgentId(id, 'discoverOwnerAgentId');
        return id;
    }

    return null;
}

function withAgentOptions(options = {}) {
    const ownerAgentId = cachedOwnerAgentId;
    if (!ownerAgentId) return { ...options };
    return { ownerAgentId, ...options };
}

async function tryBrowserCommand(command, attempts) {
    const errors = [];
    for (const attempt of attempts) {
        try {
            const result = await vscode.commands.executeCommand(command, ...attempt.args);
            return result;
        } catch (err) {
            errors.push({ label: attempt.label, error: err.message || String(err) });
        }
    }
    const msg = errors.map(e => `${e.label}: ${e.error}`).join(' | ');
    if (/ownerAgentId/i.test(msg)) {
        throw new Error(
            'ownerAgentId missing — Cursor requires a browser agent session. ' +
            'Run: Ctrl+Shift+P → "os1 Browser Bridge: Create Script Session" ' +
            '(or "Capture Agent Context" with Agent chat open). ' +
            `Details: ${msg}`
        );
    }
    throw new Error(`Browser command ${command} failed: ${msg}`);
}

async function browserNavigate(url, viewId, newTab) {
    const ownerAgentId = await ensureScriptAgentContext();
    const opts = withAgentOptions({ preserveFocus: true });

    if (viewId) {
        return tryBrowserCommand('cursor.browserView.navigate', [
            { label: 'object', args: [{ url, viewId, ...opts }] },
            { label: 'owner-url-view-opts', args: [ownerAgentId, url, viewId, opts] },
            { label: 'url-view-opts', args: [url, viewId, opts] },
            { label: 'url-view', args: [url, viewId] },
        ]);
    }

    if (newTab) {
        const created = await tryBrowserCommand('cursor.browserView.newTab', [
            { label: 'object', args: [{ url, ...opts }] },
            { label: 'owner-url-opts', args: [ownerAgentId, url, opts] },
            { label: 'url-opts', args: [url, opts] },
            { label: 'url', args: [url] },
        ]);
        return created;
    }

    return tryBrowserCommand('cursor.browserView.navigate', [
        { label: 'object-new', args: [{ url, newTab: true, ...opts }] },
        { label: 'owner-url-opts', args: [ownerAgentId, url, opts] },
        { label: 'url-opts', args: [url, opts] },
        { label: 'url', args: [url] },
    ]);
}

async function browserExecJS(script, viewId, headless = false) {
    const ownerAgentId = await ensureScriptAgentContext();
    const opts = withAgentOptions();
    return tryBrowserCommand('cursor.browserView.executeJavaScript', [
        { label: 'script-view-headless-opts', args: [script, viewId, headless, opts] },
        { label: 'owner-script-view-headless', args: [ownerAgentId, script, viewId, headless] },
        { label: 'script-view-headless', args: [script, viewId, headless] },
        { label: 'object', args: [{ script, viewId, headless, ...opts }] },
    ]);
}

/** Resolve a viewId, falling back to the first visible (non-headless) tab. */
async function resolveViewId(requestedId) {
    await ensureScriptAgentContext();
    const info = await listTabsInfo();
    const tabs = info?.tabs ?? [];
    if (requestedId && tabs.includes(requestedId)) return requestedId;
    const headless = new Set(info?.headlessTabs ?? []);
    const visible = tabs.find(t => !headless.has(t));
    return visible ?? tabs[0] ?? null;
}

/** Execute JavaScript in a browser tab. */
async function execJS(script, viewId, headless) {
    return browserExecJS(script, viewId, headless);
}

/** Convert an accessibility tree node to indented YAML. */
function treeToYaml(node, indent = 0) {
    if (!node) return '';
    const pad = '  '.repeat(indent);
    let line = `${pad}- ${node.role || 'element'}`;
    if (node.name) line += ` "${node.name}"`;
    if (node.ref) line += ` [ref=${node.ref}]`;
    if (node.level) line += ` [level=${node.level}]`;
    if (node.tag) line += ` <${node.tag}>`;
    if (node.states?.length) line += ` (${node.states.join(', ')})`;
    if (node.value !== undefined) line += ` value="${node.value}"`;
    if (node.placeholder) line += ` placeholder="${node.placeholder}"`;
    if (node.url) line += ` url="${node.url}"`;
    if (node.description) line += ` desc="${node.description}"`;
    if (node.options) line += ` options=[${node.options}]`;
    if (node.nth !== undefined) line += ` [nth=${node.nth}]`;
    let result = line + '\n';
    if (node.children) {
        for (const child of node.children) {
            result += treeToYaml(child, indent + 1);
        }
    }
    return result;
}

function textResult(text, viewId) {
    const content = [{ type: 'text', text }];
    if (viewId) content.push({ type: 'metadata', viewId });
    return { content };
}

// ---------------------------------------------------------------------------
// Injected JS helpers — loaded lazily from snapshot.js
// ---------------------------------------------------------------------------

let SNAPSHOT_JS = null;

function loadSnapshotJS() {
    if (!SNAPSHOT_JS) {
        SNAPSHOT_JS = fs.readFileSync(path.join(__dirname, 'snapshot.js'), 'utf8');
    }
}

// Minimal element finder — injected inline, no external file needed.
// Replaces the extracted cursor-browser-automation element-finder which had
// escaping issues.  This is ~40 lines vs 14KB and actually works.
const ELEMENT_FINDER_JS = `
function findElementByRef(ref) {
    var el = document.querySelector('[data-cursor-ref="' + ref + '"]');
    if (!el) return { element: null };
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return { element: null };
    return { element: el };
}
function validateElement(el, ref, action) {
    if (!el) throw new Error('Element not found: ' + ref + '. Take a snapshot to get updated refs.');
    var style = window.getComputedStyle(el);
    if (style.display === 'none') throw new Error('Element ' + ref + ' is hidden (display:none).');
    if (style.visibility === 'hidden') throw new Error('Element ' + ref + ' is hidden (visibility:hidden).');
    if (el.disabled) throw new Error('Element ' + ref + ' is disabled.');
    if ((action === 'fill' || action === 'type') && el.readOnly) {
        throw new Error('Element ' + ref + ' is readonly.');
    }
}
`;

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

const tools = {
    async browser_navigate(args) {
        const url = args.url;
        if (!url) return textResult('Error: url is required');

        const info = await listTabsInfo();
        const tabs = info?.tabs ?? [];
        const headless = new Set(info?.headlessTabs ?? []);

        if (args.viewId && tabs.includes(args.viewId)) {
            await browserNavigate(url, args.viewId, false);
            return tools.browser_snapshot({ viewId: args.viewId });
        }

        if (tabs.length > 0 && !args.newTab) {
            const visible = tabs.find(t => !headless.has(t));
            if (visible) {
                await browserNavigate(url, visible, false);
                return tools.browser_snapshot({ viewId: visible });
            }
        }

        const result = await browserNavigate(url, null, true);
        const viewId = result?.browserId ?? result?.viewId ?? result?.tabId;
        if (viewId) return tools.browser_snapshot({ viewId });
        return textResult('Failed to open browser tab');
    },

    async browser_snapshot(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available. Navigate to a page first.');

        loadSnapshotJS();
        const options = {
            interactive: args?.interactive ?? false,
            maxDepth: args?.maxDepth ?? 20,
            selector: args?.selector ?? null,
        };

        const script = `
            ${SNAPSHOT_JS}
            (function() {
                var options = ${JSON.stringify(options)};
                var result = buildPageSnapshot(options);
                return {
                    success: true,
                    pageState: {
                        url: window.location.href,
                        title: document.title,
                        snapshot: result.tree
                    },
                    stats: result.stats
                };
            })();
        `;

        const result = await execJS(script, viewId);
        if (!result?.success) return textResult('Snapshot failed: ' + JSON.stringify(result));

        const yaml = treeToYaml(result.pageState.snapshot);
        const { url, title } = result.pageState;
        const stats = result.stats || {};

        let text = `Page: ${title}\nURL: ${url}\n`;
        text += `Refs: ${stats.totalRefs || 0} total, ${stats.interactiveRefs || 0} interactive\n\n`;
        text += yaml;

        return {
            content: [
                { type: 'text', text },
                { type: 'metadata', viewId, title, url, locked: false }
            ]
        };
    },

    async browser_click(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');

        const script = `
            ${ELEMENT_FINDER_JS}
            (function() {
                var ref = ${JSON.stringify(args.ref)};
                var result = findElementByRef(ref);
                validateElement(result.element, ref, 'click');
                var el = result.element;
                el.scrollIntoView({ behavior: 'instant', block: 'center' });
                var rect = el.getBoundingClientRect();
                var x = rect.left + rect.width / 2;
                var y = rect.top + rect.height / 2;
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
                el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, clientX: x, clientY: y }));
                el.dispatchEvent(new MouseEvent('click',     { bubbles: true, clientX: x, clientY: y }));
                return { success: true };
            })();
        `;

        const result = await execJS(script, viewId);
        if (!result?.success) return textResult('Click failed: ' + (result?.error || JSON.stringify(result)));
        return textResult(`Clicked element [ref=${args.ref}]`, viewId);
    },

    async browser_type(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');

        const script = `
            ${ELEMENT_FINDER_JS}
            (function() {
                var ref = ${JSON.stringify(args.ref)};
                var text = ${JSON.stringify(args.text || '')};
                var result = findElementByRef(ref);
                validateElement(result.element, ref, 'type');
                var el = result.element;
                el.focus();
                for (var i = 0; i < text.length; i++) {
                    var ch = text[i];
                    el.dispatchEvent(new KeyboardEvent('keydown',  { key: ch, bubbles: true }));
                    el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
                    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                        el.value += ch;
                    } else if (el.isContentEditable) {
                        document.execCommand('insertText', false, ch);
                    }
                    el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true };
            })();
        `;

        const result = await execJS(script, viewId);
        if (!result?.success) return textResult('Type failed: ' + (result?.error || JSON.stringify(result)));
        return textResult(`Typed "${args.text}" into [ref=${args.ref}]`, viewId);
    },

    async browser_fill(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');

        const script = `
            ${ELEMENT_FINDER_JS}
            (function() {
                var ref = ${JSON.stringify(args.ref)};
                var value = ${JSON.stringify(args.value || '')};
                var result = findElementByRef(ref);
                validateElement(result.element, ref, 'fill');
                var el = result.element;
                el.focus();
                // Use native setter to bypass React/framework controlled input guards
                var nativeSetter = Object.getOwnPropertyDescriptor(
                    el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
                    'value'
                )?.set;
                if (nativeSetter) {
                    nativeSetter.call(el, value);
                } else {
                    el.value = value;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true };
            })();
        `;

        const result = await execJS(script, viewId);
        if (!result?.success) return textResult('Fill failed: ' + (result?.error || JSON.stringify(result)));
        return textResult(`Filled [ref=${args.ref}] with "${args.value}"`, viewId);
    },

    async browser_screenshot(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');

        const result = await vscode.commands.executeCommand('cursor.browserView.takeScreenshot', {
            viewId,
            ...(args?.type && { type: args.type }),
        });

        if (!result?.success || !result?.dataUrl) {
            return textResult('Screenshot failed: ' + (result?.error || 'No image data'));
        }

        const match = result.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
            return {
                content: [
                    { type: 'text', text: 'Screenshot captured.' },
                    { type: 'image', data: match[2], mimeType: match[1] },
                    { type: 'metadata', viewId }
                ]
            };
        }
        return textResult('Screenshot captured but could not parse image data.', viewId);
    },

    async browser_tabs() {
        const info = await vscode.commands.executeCommand('cursor.browserView.listTabs');
        const tabs = info?.tabs ?? [];
        if (!tabs.length) return textResult('No browser tabs open.');

        const lines = await Promise.all(tabs.map(async (id, i) => {
            const [url, title] = await Promise.all([
                vscode.commands.executeCommand('cursor.browserView.getURL', id),
                vscode.commands.executeCommand('cursor.browserView.getTitle', id),
            ]);
            return `[${i}] "${title || 'New Tab'}" - ${url || 'about:blank'} (viewId: ${id})`;
        }));

        return textResult('Open tabs:\n' + lines.join('\n'));
    },

    async browser_lock(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        await vscode.commands.executeCommand('cursor.browserView.setLocked', viewId, true);
        return textResult('Browser locked.', viewId);
    },

    async browser_unlock(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        await vscode.commands.executeCommand('cursor.browserView.setLocked', viewId, false);
        return textResult('Browser unlocked.', viewId);
    },

    async browser_navigate_back(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        await vscode.commands.executeCommand('cursor.browserView.goBack', viewId);
        return tools.browser_snapshot({ viewId });
    },

    async browser_navigate_forward(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        await vscode.commands.executeCommand('cursor.browserView.goForward', viewId);
        return tools.browser_snapshot({ viewId });
    },

    async browser_reload(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        await vscode.commands.executeCommand('cursor.browserView.reload', viewId);
        return textResult('Page reloaded.', viewId);
    },

    async browser_console_messages(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const logs = await vscode.commands.executeCommand('cursor.browserView.getConsoleLogs', viewId);
        return textResult(JSON.stringify(logs, null, 2), viewId);
    },

    async browser_network_requests(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const reqs = await vscode.commands.executeCommand('cursor.browserView.getNetworkRequests', viewId);
        return textResult(JSON.stringify(reqs, null, 2), viewId);
    },

    async browser_press_key(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');

        const script = `(function() {
            var key = ${JSON.stringify(args.key || '')};
            var el = document.activeElement || document.body;
            el.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup',   { key: key, bubbles: true }));
            return { success: true };
        })();`;
        await execJS(script, viewId);
        return textResult(`Pressed key: ${args.key}`, viewId);
    },

    async browser_hover(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');

        const script = `
            ${ELEMENT_FINDER_JS}
            (function() {
                var ref = ${JSON.stringify(args.ref)};
                var result = findElementByRef(ref);
                validateElement(result.element, ref, 'hover');
                var el = result.element;
                el.scrollIntoView({ behavior: 'instant', block: 'center' });
                var rect = el.getBoundingClientRect();
                var x = rect.left + rect.width / 2;
                var y = rect.top + rect.height / 2;
                el.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true, clientX: x, clientY: y }));
                el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: x, clientY: y }));
                el.dispatchEvent(new MouseEvent('mousemove',  { bubbles: true, clientX: x, clientY: y }));
                return { success: true };
            })();
        `;
        await execJS(script, viewId);
        return textResult(`Hovered over [ref=${args.ref}]`, viewId);
    },

    async browser_resize(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        await vscode.commands.executeCommand(
            'cursor.browserView.resize', { viewId, width: args.width, height: args.height }
        );
        return textResult(`Resized to ${args.width}x${args.height}`, viewId);
    },

    async browser_evaluate(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const result = await execJS(args.script, viewId);
        return textResult(JSON.stringify(result, null, 2), viewId);
    },
};

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function startServer(output) {
    const server = http.createServer(async (req, res) => {
        const respond = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
        };

        if (req.method === 'GET' && req.url === '/debug/tabs') {
            return respond(200, {
                info: await listTabsInfo(),
                cachedOwnerAgentId,
                agentIdFile: workspaceAgentIdFile(),
            });
        }

        if (req.method === 'GET' && req.url === '/debug/commands') {
            const all = await vscode.commands.getCommands(true);
            const commands = all
                .filter(c => /cursor\.(browser|agent|composer|chat|mcp)/i.test(c))
                .sort();
            return respond(200, { commands });
        }

        if (req.method === 'POST' && req.url === '/register-script-session') {
            cachedOwnerAgentId = null;
            const id = await registerScriptOwnerAgent() || await discoverOwnerAgentId();
            if (id) persistOwnerAgentId(id, 'http-register-script-session');
            return respond(id ? 200 : 503, { ok: Boolean(id), ownerAgentId: id });
        }

        if (req.method === 'GET' && req.url === '/health') {
            return respond(200, { ok: true });
        }

        if (req.method === 'POST' && req.url === '/tool') {
            const chunks = [];
            req.on('data', c => chunks.push(c));
            req.on('end', async () => {
                try {
                    const { name, args } = JSON.parse(Buffer.concat(chunks).toString());
                    const handler = tools[name];
                    if (!handler) return respond(404, { error: `Unknown tool: ${name}` });

                    output.appendLine(`[Bridge] ${name}`);
                    const result = await handler(args || {});
                    respond(200, result);
                } catch (err) {
                    output.appendLine(`[Bridge] Error: ${err.message}`);
                    respond(500, { error: err.message, stack: err.stack });
                }
            });
            return;
        }

        respond(404, { error: 'Not found' });
    });

    server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        output.appendLine(`[Bridge] HTTP server listening on 127.0.0.1:${port}`);
        fs.writeFileSync(PORT_FILE, String(port), 'utf8');
        output.appendLine(`[Bridge] Port written to ${PORT_FILE}`);
    });

    return server;
}

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

let server = null;

/** @param {vscode.ExtensionContext} context */
async function activate(context) {
    extensionContext = context;
    extensionOutput = vscode.window.createOutputChannel('Browser Bridge');
    extensionOutput.appendLine('[Browser Bridge] Activating...');
    loadPersistedOwnerAgentId();

    context.subscriptions.push(
        vscode.commands.registerCommand('os1BrowserBridge.createScriptSession', async () => {
            cachedOwnerAgentId = null;
            const id = await registerScriptOwnerAgent();
            if (id) {
                persistOwnerAgentId(id, 'palette-createScriptSession');
                vscode.window.showInformationMessage(`os1 Browser Bridge: script session ready (${id})`);
            } else {
                vscode.window.showErrorMessage(
                    'os1 Browser Bridge: could not create script session. Enable Browser Automation in Settings → Tools & MCP, reload Cursor, retry.'
                );
            }
        }),
        vscode.commands.registerCommand('os1BrowserBridge.captureAgentContext', async () => {
            cachedOwnerAgentId = null;
            const id = await discoverOwnerAgentId();
            if (id) {
                persistOwnerAgentId(id, 'palette-captureAgentContext');
                vscode.window.showInformationMessage(`os1 Browser Bridge: captured agent context (${id})`);
            } else {
                vscode.window.showWarningMessage(
                    'os1 Browser Bridge: no active Agent context found. Open Agent chat or run Create Script Session first.'
                );
            }
        }),
    );

    server = startServer(extensionOutput);
    context.subscriptions.push({
        dispose: () => {
            server?.close();
            try { fs.unlinkSync(PORT_FILE); } catch (_) {}
        }
    });

    extensionOutput.appendLine('[Browser Bridge] Ready.');
}

function deactivate() {
    server?.close();
    try { fs.unlinkSync(PORT_FILE); } catch (_) {}
}

module.exports = { activate, deactivate };
