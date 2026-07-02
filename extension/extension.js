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
const { TOOL_SCHEMAS, REST_ROUTES } = require('./lib/tool-schemas');
const { runOdooLogin, runWaitFor } = require('./lib/odoo-login');
const { snapshotUrl, toolText, toolMeta } = require('./lib/refs');
const {
    designEnable,
    designDisable,
    designDuplicate,
    designAddContainer,
    designList,
    designRemove,
    designMove,
} = require('./lib/design-api');

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

function parseQuery(reqUrl) {
    const u = new URL(reqUrl, 'http://127.0.0.1');
    const q = {};
    u.searchParams.forEach((v, k) => { q[k] = v; });
    return q;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString();
                resolve(raw ? JSON.parse(raw) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

function workspaceFolder() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
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

    async browser_take_screenshot(args) {
        return tools.browser_screenshot(args);
    },

    async browser_scroll(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const amount = args.amount ?? 300;
        let dx = args.deltaX ?? 0;
        let dy = args.deltaY ?? 0;
        if (!args.deltaX && !args.deltaY && args.direction) {
            if (args.direction === 'down') dy = amount;
            else if (args.direction === 'up') dy = -amount;
            else if (args.direction === 'right') dx = amount;
            else if (args.direction === 'left') dx = -amount;
        }
        const script = `
            ${ELEMENT_FINDER_JS}
            (function() {
                var ref = ${JSON.stringify(args.ref || null)};
                var dx = ${dx}, dy = ${dy};
                var scrollIntoView = ${Boolean(args.scrollIntoView)};
                if (ref) {
                    var result = findElementByRef(ref);
                    if (!result.element) return { success: false, error: 'ref not found' };
                    if (scrollIntoView) result.element.scrollIntoView({ block: 'center', behavior: 'instant' });
                    else result.element.scrollBy(dx, dy);
                    return { success: true };
                }
                window.scrollBy(dx, dy);
                return { success: true };
            })();
        `;
        const result = await execJS(script, viewId);
        if (!result?.success) return textResult('Scroll failed: ' + JSON.stringify(result), viewId);
        return textResult(`Scrolled dx=${dx} dy=${dy}`, viewId);
    },

    async browser_select_option(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const values = args.values || [];
        const script = `
            ${ELEMENT_FINDER_JS}
            (function() {
                var ref = ${JSON.stringify(args.ref)};
                var values = ${JSON.stringify(values)};
                var result = findElementByRef(ref);
                validateElement(result.element, ref, 'fill');
                var sel = result.element;
                if (sel.tagName !== 'SELECT') return { success: false, error: 'not a select' };
                for (var i = 0; i < sel.options.length; i++) {
                    var opt = sel.options[i];
                    var hit = values.some(function(v) {
                        return opt.value === v || opt.text === v || opt.label === v;
                    });
                    opt.selected = hit;
                }
                sel.dispatchEvent(new Event('input', { bubbles: true }));
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true };
            })();
        `;
        const result = await execJS(script, viewId);
        if (!result?.success) return textResult('Select failed: ' + JSON.stringify(result), viewId);
        return textResult(`Selected ${values.join(', ')} on [ref=${args.ref}]`, viewId);
    },

    async browser_drag(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const script = `
            ${ELEMENT_FINDER_JS}
            (function() {
                var sourceRef = ${JSON.stringify(args.sourceRef)};
                var targetRef = ${JSON.stringify(args.targetRef || null)};
                var tx = ${args.targetX ?? 'null'};
                var ty = ${args.targetY ?? 'null'};
                var src = findElementByRef(sourceRef);
                validateElement(src.element, sourceRef, 'click');
                var srect = src.element.getBoundingClientRect();
                var sx = srect.left + srect.width / 2;
                var sy = srect.top + srect.height / 2;
                var ex = sx, ey = sy;
                if (targetRef) {
                    var tgt = findElementByRef(targetRef);
                    validateElement(tgt.element, targetRef, 'click');
                    var trect = tgt.element.getBoundingClientRect();
                    ex = trect.left + trect.width / 2;
                    ey = trect.top + trect.height / 2;
                } else if (tx !== null && ty !== null) { ex = tx; ey = ty; }
                function fire(type, x, y) {
                    var el = document.elementFromPoint(x, y) || document.body;
                    el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 }));
                }
                fire('mousedown', sx, sy);
                fire('mousemove', ex, ey);
                fire('mouseup', ex, ey);
                return { success: true, from: { x: sx, y: sy }, to: { x: ex, y: ey } };
            })();
        `;
        const result = await execJS(script, viewId);
        if (!result?.success) return textResult('Drag failed: ' + JSON.stringify(result), viewId);
        return textResult(`Dragged [ref=${args.sourceRef}]`, viewId);
    },

    async browser_get_bounding_box(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const script = `
            ${ELEMENT_FINDER_JS}
            (function() {
                var ref = ${JSON.stringify(args.ref)};
                var result = findElementByRef(ref);
                if (!result.element) return { success: false, error: 'ref not found' };
                var r = result.element.getBoundingClientRect();
                return { success: true, x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left };
            })();
        `;
        const result = await execJS(script, viewId);
        return textResult(JSON.stringify(result, null, 2), viewId);
    },

    async browser_highlight(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const duration = args.durationMs ?? 2000;
        const script = `
            ${ELEMENT_FINDER_JS}
            (function() {
                var ref = ${JSON.stringify(args.ref)};
                var duration = ${duration};
                var result = findElementByRef(ref);
                if (!result.element) return { success: false, error: 'ref not found' };
                var el = result.element;
                var prev = el.style.outline;
                el.style.outline = '3px solid #ff6600';
                setTimeout(function() { el.style.outline = prev; }, duration);
                return { success: true };
            })();
        `;
        await execJS(script, viewId);
        return textResult(`Highlighted [ref=${args.ref}] for ${duration}ms`, viewId);
    },

    async browser_mouse_click_xy(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const button = args.button || 'left';
        const script = `
            (function() {
                var x = ${args.x}, y = ${args.y};
                var btn = ${JSON.stringify(button)};
                var el = document.elementFromPoint(x, y) || document.body;
                var map = { left: 0, middle: 1, right: 2 };
                var b = map[btn] ?? 0;
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, button: b }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y, button: b }));
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, button: b }));
                return { success: true, tag: el.tagName };
            })();
        `;
        const result = await execJS(script, viewId);
        return textResult(`Clicked at (${args.x}, ${args.y})`, viewId);
    },

    async browser_cdp(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const method = args.method;
        const params = args.params || {};
        const cdpCmds = [
            'cursor.browserView.sendCdpCommand',
            'cursor.browserView.cdp',
            'cursor.browserView.executeCdp',
            'cursor.browserView.sendCDP',
        ];
        for (const cmd of cdpCmds) {
            try {
                const result = await vscode.commands.executeCommand(cmd, { viewId, method, params });
                return textResult(JSON.stringify(result, null, 2), viewId);
            } catch (_) { /* try next */ }
        }
        if (method === 'Runtime.evaluate' && params.expression) {
            const result = await execJS(params.expression, viewId);
            return textResult(JSON.stringify({ result }, null, 2), viewId);
        }
        return textResult(`CDP ${method} not available via bridge`, viewId);
    },

    async browser_close_tab(args) {
        const viewId = args.viewId || await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab to close.');
        const closeCmds = [
            ['cursor.browserView.closeTab', viewId],
            ['cursor.browserView.close', viewId],
            ['cursor.browserView.closeTab', { viewId }],
        ];
        for (const [cmd, arg] of closeCmds) {
            try {
                await vscode.commands.executeCommand(cmd, arg);
                return textResult(`Closed tab ${viewId}`, viewId);
            } catch (_) { /* try next */ }
        }
        return textResult(`Could not close tab ${viewId}`, viewId);
    },

    async browser_design_enable(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const result = await designEnable(execJS, viewId);
        return textResult(JSON.stringify(result, null, 2), viewId);
    },

    async browser_design_disable(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const result = await designDisable(execJS, viewId);
        return textResult(JSON.stringify(result, null, 2), viewId);
    },

    async browser_design_duplicate(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const result = await designDuplicate(execJS, viewId, args || {});
        return textResult(JSON.stringify(result, null, 2), viewId);
    },

    async browser_design_add_container(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const result = await designAddContainer(execJS, viewId, args || {});
        return textResult(JSON.stringify(result, null, 2), viewId);
    },

    async browser_design_list(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const result = await designList(execJS, viewId);
        return textResult(JSON.stringify(result, null, 2), viewId);
    },

    async browser_design_remove(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const result = await designRemove(execJS, viewId, args.id);
        return textResult(JSON.stringify(result, null, 2), viewId);
    },

    async browser_design_move(args) {
        const viewId = await resolveViewId(args?.viewId);
        if (!viewId) return textResult('No browser tab available.');
        const result = await designMove(execJS, viewId, args || {});
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

        const pathname = (req.url || '/').split('?')[0];

        try {
            if (req.method === 'GET' && pathname === '/debug/tabs') {
                return respond(200, {
                    info: await listTabsInfo(),
                    cachedOwnerAgentId,
                    agentIdFile: workspaceAgentIdFile(),
                });
            }

            if (req.method === 'GET' && pathname === '/debug/commands') {
                const all = await vscode.commands.getCommands(true);
                const commands = all
                    .filter(c => /cursor\.(browser|agent|composer|chat|mcp)/i.test(c))
                    .sort();
                return respond(200, { commands });
            }

            if (req.method === 'GET' && pathname === '/health') {
                return respond(200, { ok: true, version: '0.4.0' });
            }

            if (req.method === 'GET' && pathname === '/tools') {
                return respond(200, { tools: TOOL_SCHEMAS, routes: REST_ROUTES });
            }

            if (req.method === 'GET' && pathname === '/tabs') {
                const result = await tools.browser_tabs({});
                return respond(200, result);
            }

            if (req.method === 'GET' && pathname === '/snapshot') {
                const q = parseQuery(req.url);
                const result = await tools.browser_snapshot({
                    viewId: q.viewId || undefined,
                    interactive: q.interactive === 'true' || q.interactive === '1',
                    maxDepth: q.maxDepth ? Number(q.maxDepth) : undefined,
                    selector: q.selector || undefined,
                });
                return respond(200, result);
            }

            if (req.method === 'GET' && pathname === '/url') {
                const q = parseQuery(req.url);
                const snap = await tools.browser_snapshot({ viewId: q.viewId || undefined });
                const text = toolText(snap);
                const url = snapshotUrl(text);
                const viewId = toolMeta(snap, 'viewId');
                return respond(200, { url, viewId });
            }

            if (req.method === 'GET' && pathname === '/title') {
                const q = parseQuery(req.url);
                const viewId = q.viewId || await resolveViewId();
                if (!viewId) return respond(404, { error: 'No browser tab' });
                const title = await execJS('document.title', viewId);
                return respond(200, { title, viewId });
            }

            if (req.method === 'POST' && pathname === '/register-script-session') {
                cachedOwnerAgentId = null;
                const id = await registerScriptOwnerAgent() || await discoverOwnerAgentId();
                if (id) persistOwnerAgentId(id, 'http-register-script-session');
                return respond(id ? 200 : 503, { ok: Boolean(id), ownerAgentId: id });
            }

            if (req.method === 'POST' && pathname === '/navigate') {
                const body = await readBody(req);
                output.appendLine(`[Bridge] POST /navigate ${body.url || ''}`);
                const result = await tools.browser_navigate(body);
                return respond(200, result);
            }

            if (req.method === 'POST' && pathname === '/close-tab') {
                const body = await readBody(req);
                const result = await tools.browser_close_tab(body);
                return respond(200, result);
            }

            if (req.method === 'POST' && pathname === '/wait-for') {
                const body = await readBody(req);
                output.appendLine('[Bridge] POST /wait-for');
                const result = await runWaitFor(tools, body);
                return respond(200, result);
            }

            if (req.method === 'POST' && pathname === '/odoo-login') {
                const body = await readBody(req);
                output.appendLine(`[Bridge] POST /odoo-login stack=${body.stack || 'handoff'}`);
                const result = await runOdooLogin(tools, body, workspaceFolder());
                return respond(200, result);
            }

            if (req.method === 'POST' && pathname === '/design/enable') {
                const body = await readBody(req);
                const viewId = await resolveViewId(body.viewId);
                if (!viewId) return respond(404, { error: 'No browser tab' });
                return respond(200, await designEnable(execJS, viewId));
            }

            if (req.method === 'POST' && pathname === '/design/disable') {
                const body = await readBody(req);
                const viewId = await resolveViewId(body.viewId);
                if (!viewId) return respond(404, { error: 'No browser tab' });
                return respond(200, await designDisable(execJS, viewId));
            }

            if (req.method === 'POST' && pathname === '/design/duplicate') {
                const body = await readBody(req);
                const viewId = await resolveViewId(body.viewId);
                if (!viewId) return respond(404, { error: 'No browser tab' });
                output.appendLine('[Bridge] POST /design/duplicate');
                return respond(200, await designDuplicate(execJS, viewId, body));
            }

            if (req.method === 'POST' && pathname === '/design/container') {
                const body = await readBody(req);
                const viewId = await resolveViewId(body.viewId);
                if (!viewId) return respond(404, { error: 'No browser tab' });
                output.appendLine('[Bridge] POST /design/container');
                return respond(200, await designAddContainer(execJS, viewId, body));
            }

            if (req.method === 'GET' && pathname === '/design/list') {
                const q = parseQuery(req.url);
                const viewId = await resolveViewId(q.viewId);
                if (!viewId) return respond(404, { error: 'No browser tab' });
                return respond(200, await designList(execJS, viewId));
            }

            if (req.method === 'POST' && pathname === '/design/remove') {
                const body = await readBody(req);
                const viewId = await resolveViewId(body.viewId);
                if (!viewId) return respond(404, { error: 'No browser tab' });
                return respond(200, await designRemove(execJS, viewId, body.id));
            }

            if (req.method === 'POST' && pathname === '/design/move') {
                const body = await readBody(req);
                const viewId = await resolveViewId(body.viewId);
                if (!viewId) return respond(404, { error: 'No browser tab' });
                return respond(200, await designMove(execJS, viewId, body));
            }

            if (req.method === 'POST' && pathname === '/tool') {
                const body = await readBody(req);
                const { name, args } = body;
                const handler = tools[name];
                if (!handler) return respond(404, { error: `Unknown tool: ${name}` });

                output.appendLine(`[Bridge] ${name}`);
                const result = await handler(args || {});
                return respond(200, result);
            }

            respond(404, { error: 'Not found', path: pathname });
        } catch (err) {
            output.appendLine(`[Bridge] Error: ${err.message}`);
            respond(500, { error: err.message, stack: err.stack });
        }
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
