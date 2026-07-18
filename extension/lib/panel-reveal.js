'use strict';

const vscode = require('vscode');

/**
 * Reveal os1 Mockup in the bottom Panel. Workbench commands proxy to the
 * local Cursor UI when this runs on a Remote SSH workspace host.
 * @param {{ focusView?: () => void }} [opts]
 */
async function revealMockupPanel(opts = {}) {
    const steps = [
        'workbench.action.togglePanel',
        'workbench.view.extension.os1BrowserBridgePanel',
        'os1BrowserBridge.mockupPanel.focus',
        'workbench.panel.reveal',
        'os1BrowserBridge.openMockupPanel',
    ];
    for (const cmd of steps) {
        try {
            await vscode.commands.executeCommand(cmd);
            opts.focusView?.();
            return { ok: true, via: cmd };
        } catch (_) { /* try next */ }
    }
    return { ok: false, error: 'Could not reveal panel — reload Cursor; confirm extension 0.5.2+ on Windows' };
}

module.exports = { revealMockupPanel };
