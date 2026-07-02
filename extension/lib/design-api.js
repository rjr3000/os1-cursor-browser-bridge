'use strict';

const fs = require('fs');
const path = require('path');

let designKitSource = null;

function loadDesignKitSource() {
    if (!designKitSource) {
        designKitSource = fs.readFileSync(path.join(__dirname, 'design-kit.js'), 'utf8');
    }
    return designKitSource;
}

/**
 * Call window.__os1Design[method](payload) in the browser tab.
 * @param {function(string, string): Promise<*>} execJS
 */
async function designInvoke(execJS, viewId, method, payload, asApply) {
    const kit = loadDesignKitSource();
    let callExpr;
    if (asApply && Array.isArray(payload)) {
        callExpr = `window.__os1Design.${method}.apply(window.__os1Design, ${JSON.stringify(payload)})`;
    } else {
        const arg = payload === undefined ? '' : JSON.stringify(payload);
        callExpr = `window.__os1Design.${method}(${arg})`;
    }
    const script = `
        ${kit}
        (function() {
            if (!window.__os1Design) return { success: false, error: 'design kit failed to load' };
            return ${callExpr};
        })();
    `;
    return execJS(script, viewId);
}

async function designEnable(execJS, viewId) {
    return designInvoke(execJS, viewId, 'enable');
}

async function designDisable(execJS, viewId) {
    return designInvoke(execJS, viewId, 'disable');
}

async function designDuplicate(execJS, viewId, body) {
    const spec = normalizeTarget(body);
    const opts = {
        label: body.label,
        float: body.float !== false,
        cloneWrapper: body.cloneWrapper !== false,
        offsetX: body.offsetX,
        offsetY: body.offsetY,
    };
    return designInvoke(execJS, viewId, 'duplicate', [spec, opts], true);
}

async function designAddContainer(execJS, viewId, body) {
    return designInvoke(execJS, viewId, 'addContainer', [body], true);
}

async function designList(execJS, viewId) {
    return designInvoke(execJS, viewId, 'list');
}

async function designRemove(execJS, viewId, id) {
    return designInvoke(execJS, viewId, 'remove', [id], true);
}

async function designMove(execJS, viewId, body) {
    return designInvoke(execJS, viewId, 'move', [body.id, body.left, body.top], true);
}

function normalizeTarget(body) {
    if (body.target) return body.target;
    if (body.ref) return { ref: body.ref };
    if (body.id) return { id: body.id };
    if (body.selector) return { selector: body.selector };
    if (body.cursorElementId) return { cursorElementId: body.cursorElementId };
    if (body.domPath) return { domPath: body.domPath };
    return body;
}

module.exports = {
    designEnable,
    designDisable,
    designDuplicate,
    designAddContainer,
    designList,
    designRemove,
    designMove,
};
