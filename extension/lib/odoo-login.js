'use strict';

const fs = require('fs');
const path = require('path');
const { findRef, snapshotUrl, toolText, toolMeta } = require('./refs');

const DEFAULT_CREDENTIALS = [
    { login: 'admin', password: 'Ivolusion2222&' },
    { login: 'admin@mvs.rg1.io', password: 'Vs2026!' },
    { login: 'admin', password: 'admin' },
];

function workspaceRoot() {
    return null; // filled by caller via vscode if needed
}

function handoffPath(root) {
    return root ? path.join(root, '.cursor', 'browser-open-request.json') : null;
}

function resolveOdooUrls(body, workspaceFolder) {
    if (body.loginUrl && body.publicUrl) {
        return { loginUrl: body.loginUrl, publicUrl: body.publicUrl, stack: body.stack || '' };
    }
    const hf = handoffPath(workspaceFolder);
    if (hf && fs.existsSync(hf)) {
        const data = JSON.parse(fs.readFileSync(hf, 'utf8'));
        return {
            loginUrl: data.url,
            publicUrl: data.public_url || data.url.replace(/\/web\/login.*/, ''),
            stack: data.stack || body.stack || '',
            credentials: data.login_candidates,
        };
    }
    const stack = (body.stack || '').replace(/^pr-ev[-_]/, '').replace(/_/g, '-');
    if (!stack) throw new Error('Provide loginUrl+publicUrl, stack, or browser-open-request.json handoff');
    const db = stack.replace(/^pr-/, '').replace(/-/g, '_');
    const host = stack.includes('live') ? stack : `pr-${stack.replace(/_/g, '-')}`;
    const publicUrl = `https://${host}.rg1.in`;
    return {
        loginUrl: `${publicUrl}/web/login?db=${db}`,
        publicUrl,
        stack,
    };
}

function looksLoggedIn(url, publicUrl) {
    if (!url || url === 'about:blank') return false;
    if (url.includes('/web/login') && url.toLowerCase().includes('login')) return false;
    if (url.includes('/odoo')) return true;
    const base = publicUrl.replace(/\/$/, '');
    if (url.replace(/\/$/, '') === base) return true;
    try {
        const u = new URL(url);
        const b = new URL(base);
        return u.hostname === b.hostname && !url.includes('/web/login');
    } catch (_) {
        return false;
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function runOdooLogin(tools, body, workspaceFolder) {
    const resolved = resolveOdooUrls(body, workspaceFolder);
    const loginUrl = resolved.loginUrl;
    const publicUrl = resolved.publicUrl;
    const credentials = body.credentials || resolved.credentials || DEFAULT_CREDENTIALS;
    const newTab = Boolean(body.newTab);
    const host = new URL(loginUrl).hostname;

    const nav = await tools.browser_navigate({ url: loginUrl, newTab });
    const navText = toolText(nav);
    if (navText.startsWith('Error') || navText.includes('Failed to open browser tab')) {
        throw new Error(`browser_navigate failed: ${navText}`);
    }
    let viewId = toolMeta(nav, 'viewId');
    if (!viewId) throw new Error('No viewId after navigate');

    const deadline = Date.now() + (body.timeoutMs || 45000);
    let lastUrl = '';
    while (Date.now() < deadline) {
        const snap = await tools.browser_snapshot({ viewId, interactive: true });
        const text = toolText(snap);
        lastUrl = snapshotUrl(text) || '';
        if (lastUrl.startsWith('chrome-error://')) {
            throw new Error(`IDE browser cannot reach ${host}`);
        }
        if (lastUrl.includes(host) && lastUrl !== 'about:blank') break;
        await sleep(1000);
    }
    if (!lastUrl.includes(host)) {
        throw new Error(`Timeout waiting for ${host} (last=${lastUrl})`);
    }

    async function revealForm() {
        let snapR = await tools.browser_snapshot({ viewId, interactive: true });
        let text = toolText(snapR);
        const another = findRef(text, 'Use another user', 'Use a different user');
        if (another) {
            await tools.browser_click({ ref: another, viewId });
            await sleep(800);
            snapR = await tools.browser_snapshot({ viewId, interactive: true });
            text = toolText(snapR);
        }
        return text;
    }

    let lastError = 'no credentials tried';
    for (const cand of credentials) {
        const login = cand.login || cand.email;
        const password = cand.password;
        const snap = await revealForm();
        const emailRef = findRef(snap, 'Enter your email', 'Email');
        const passRef = findRef(snap, 'Enter your password', 'Password');
        const submitRef = findRef(snap, 'Log in');
        if (!emailRef || !passRef || !submitRef) {
            lastError = 'login form refs missing';
            continue;
        }
        await tools.browser_fill({ ref: emailRef, value: login, viewId });
        await tools.browser_fill({ ref: passRef, value: password, viewId });
        await tools.browser_click({ ref: submitRef, viewId });

        for (let i = 0; i < 25; i++) {
            await sleep(1000);
            const snapR = await tools.browser_snapshot({ viewId });
            const url = snapshotUrl(toolText(snapR)) || '';
            if (looksLoggedIn(url, publicUrl)) {
                return {
                    ok: true,
                    stack: resolved.stack,
                    login,
                    url,
                    viewId,
                };
            }
            const snap2 = toolText(await tools.browser_snapshot({ viewId, interactive: true }));
            if (snap2.includes('Wrong login') || snap2.includes('Invalid')) {
                lastError = `invalid credentials for ${login}`;
                break;
            }
        }
        const finalSnap = await tools.browser_snapshot({ viewId });
        const finalUrl = snapshotUrl(toolText(finalSnap)) || '';
        if (looksLoggedIn(finalUrl, publicUrl)) {
            return { ok: true, stack: resolved.stack, login, url: finalUrl, viewId };
        }
        lastError = `credential ${login} did not reach apps home (url=${finalUrl})`;
    }
    throw new Error(`Odoo login failed: ${lastError}`);
}

async function runWaitFor(tools, body) {
    const viewId = body.viewId || null;
    const timeoutMs = body.timeoutMs || 30000;
    const deadline = Date.now() + timeoutMs;
    let last = {};

    while (Date.now() < deadline) {
        if (body.ref) {
            const snap = await tools.browser_snapshot({ viewId, interactive: true });
            const text = toolText(snap);
            if (text.includes(`[ref=${body.ref}]`)) {
                return { ok: true, matched: 'ref', ref: body.ref, snapshot: text.slice(0, 500) };
            }
            last = { type: 'ref', ref: body.ref };
        } else {
            const snap = await tools.browser_snapshot({ viewId, interactive: Boolean(body.interactive) });
            const text = toolText(snap);
            const url = snapshotUrl(text) || '';
            last = { url, textSnippet: text.slice(0, 200) };
            if (body.host && url.includes(body.host) && url !== 'about:blank') {
                return { ok: true, matched: 'host', url };
            }
            if (body.urlContains && url.includes(body.urlContains)) {
                return { ok: true, matched: 'urlContains', url };
            }
            if (body.text && text.includes(body.text)) {
                return { ok: true, matched: 'text', url };
            }
        }
        await sleep(500);
    }
    throw new Error(`wait-for timeout: ${JSON.stringify(last)}`);
}

module.exports = { runOdooLogin, runWaitFor, looksLoggedIn };
