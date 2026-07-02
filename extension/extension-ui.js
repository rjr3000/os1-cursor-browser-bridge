'use strict';

/**
 * UI extension host (Windows Cursor client when using Remote SSH).
 * Drives browser via cursor.browserView.* directly — docks mockup panel in Secondary Side Bar.
 */
const vscode = require('vscode');
const {
    designEnable,
    designDisable,
    designDuplicate,
    designAddContainer,
    designList,
    designRemove,
} = require('./lib/design-api');
const { mockupPanelUiHtml } = require('./lib/mockup-panel-ui-html');

/** @type {vscode.OutputChannel | null} */
let uiOutput = null;

async function listTabsInfo() {
    return vscode.commands.executeCommand('cursor.browserView.listTabs');
}

async function resolveViewId(requestedId) {
    const info = await listTabsInfo();
    const tabs = info?.tabs ?? [];
    if (requestedId && tabs.includes(requestedId)) return requestedId;
    const headless = new Set(info?.headlessTabs ?? []);
    return tabs.find(t => !headless.has(t)) ?? tabs[0] ?? null;
}

async function execJS(script, viewId) {
    const vid = viewId || await resolveViewId();
    if (!vid) throw new Error('No IDE browser tab open.');
    try {
        return await vscode.commands.executeCommand(
            'cursor.browserView.executeJavaScript',
            script,
            vid,
        );
    } catch (err) {
        throw new Error(`executeJavaScript failed: ${err.message}`);
    }
}

async function runDesign(fn) {
    const viewId = await resolveViewId();
    if (!viewId) throw new Error('Open the Cursor IDE browser tab first (login live1).');
    return fn(viewId);
}

class UiMockupPanelProvider {
    constructor() {
        /** @type {vscode.WebviewView | null} */
        this._view = null;
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = mockupPanelUiHtml();

        webviewView.webview.onDidReceiveMessage(async msg => {
            try {
                await this._handle(msg, webviewView.webview);
            } catch (err) {
                webviewView.webview.postMessage({ log: err.message });
            }
        });
    }

    async _handle(msg, webview) {
        const post = (obj) => webview.postMessage(obj);
        if (msg.cmd === 'enable') {
            const r = await runDesign(v => designEnable(execJS, v));
            try { await vscode.commands.executeCommand('cursor.browserAutomation.reinjectUIScript'); } catch (_) {}
            post({ log: r?.message || 'Mockup enabled — drag orange outlines on page' });
            return;
        }
        if (msg.cmd === 'disable') {
            const r = await runDesign(v => designDisable(execJS, v));
            post({ log: 'Disabled' });
            return r;
        }
        if (msg.cmd === 'duplicate') {
            const body = { float: true, label: msg.label || undefined };
            body[msg.type || 'id'] = msg.value;
            const r = await runDesign(v => designDuplicate(execJS, v, body));
            post({ log: r?.message || JSON.stringify(r) });
            await this._refresh(webview);
            return;
        }
        if (msg.cmd === 'container') {
            const r = await runDesign(v => designAddContainer(execJS, v, {
                imageUrl: msg.imageUrl || undefined,
                label: msg.label || 'Mockup',
                width: 400,
                height: 240,
            }));
            post({ log: r?.message || 'Container added' });
            await this._refresh(webview);
            return;
        }
        if (msg.cmd === 'remove') {
            await runDesign(v => designRemove(execJS, v, msg.id));
            await this._refresh(webview);
            return;
        }
        if (msg.cmd === 'refresh') {
            await this._refresh(webview);
        }
    }

    async _refresh(webview) {
        try {
            const r = await runDesign(v => designList(execJS, v));
            webview.postMessage({ items: r?.items || [] });
        } catch (err) {
            webview.postMessage({ log: err.message });
        }
    }

    focus() {
        if (this._view) {
            this._view.show?.(true);
        }
    }
}

const uiMockupProvider = new UiMockupPanelProvider();

async function focusMockupSidebar() {
    const cmds = [
        'workbench.view.extension.os1BrowserBridgeSidebar',
        'os1BrowserBridge.mockupSidebar.focus',
    ];
    for (const c of cmds) {
        try {
            await vscode.commands.executeCommand(c);
            return true;
        } catch (_) { /* try next */ }
    }
    try {
        await vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    } catch (_) {}
    return false;
}

/** @param {vscode.ExtensionContext} context */
async function activate(context) {
    uiOutput = vscode.window.createOutputChannel('Browser Bridge (UI)');
    uiOutput.appendLine('[Browser Bridge UI] Activating on local Cursor client…');

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('os1BrowserBridge.mockupSidebar', uiMockupProvider, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
        vscode.commands.registerCommand('os1BrowserBridge.openMockupPanel', async () => {
            await focusMockupSidebar();
        }),
        vscode.commands.registerCommand('os1BrowserBridge.enableMockupMode', async () => {
            await runDesign(v => designEnable(execJS, v));
            try { await vscode.commands.executeCommand('cursor.browserAutomation.reinjectUIScript'); } catch (_) {}
            await focusMockupSidebar();
            vscode.window.showInformationMessage('os1 Mockup: enabled — see Secondary Side Bar tab after CSS');
        }),
        vscode.commands.registerCommand('os1BrowserBridge.disableMockupMode', async () => {
            await runDesign(v => designDisable(execJS, v));
        }),
        vscode.commands.registerCommand('os1BrowserBridge.duplicateElement', async () => {
            const pick = await vscode.window.showQuickPick(
                [
                    { label: 'Element id (#result_app_6)', pick: 'id' },
                    { label: 'CSS selector', pick: 'selector' },
                    { label: 'Cursor data-cursor-element-id', pick: 'cursorElementId' },
                ],
                { title: 'os1 Mockup: target' },
            );
            if (!pick) return;
            const value = await vscode.window.showInputBox({ title: pick.label, placeHolder: 'result_app_6' });
            if (!value) return;
            const label = await vscode.window.showInputBox({ title: 'Label (optional)' });
            const body = { float: true, [pick.pick]: value, label: label || undefined };
            await runDesign(v => designDuplicate(execJS, v, body));
            await focusMockupSidebar();
        }),
        vscode.commands.registerCommand('os1BrowserBridge.addImageContainer', async () => {
            const imageUrl = await vscode.window.showInputBox({ title: 'Image URL (optional)' });
            if (imageUrl === undefined) return;
            const label = await vscode.window.showInputBox({ title: 'Caption' });
            await runDesign(v => designAddContainer(execJS, v, {
                imageUrl: imageUrl || undefined,
                label: label || 'Mockup',
                width: 400,
                height: 240,
            }));
            await focusMockupSidebar();
        }),
        vscode.commands.registerCommand('os1BrowserBridge.listMockupElements', async () => {
            const r = await runDesign(v => designList(execJS, v));
            uiOutput.appendLine(JSON.stringify(r, null, 2));
            vscode.window.showInformationMessage(`os1 Mockup: ${r?.count || 0} element(s)`);
        }),
    );

    uiOutput.appendLine('[Browser Bridge UI] Ready — Secondary Side Bar → os1 Mockup');
}

function deactivate() {}

module.exports = { activate, deactivate };
