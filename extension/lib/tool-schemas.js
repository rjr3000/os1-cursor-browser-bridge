'use strict';

const TOOL_SCHEMAS = {
    browser_navigate: {
        description: 'Navigate to URL; returns snapshot',
        args: { url: 'string (required)', newTab: 'boolean', viewId: 'string' },
    },
    browser_snapshot: {
        description: 'Accessibility snapshot with element refs',
        args: { viewId: 'string', interactive: 'boolean', maxDepth: 'number', selector: 'string' },
    },
    browser_click: { description: 'Click element by ref', args: { ref: 'string (required)', viewId: 'string' } },
    browser_fill: { description: 'Clear and fill input by ref', args: { ref: 'string (required)', value: 'string', viewId: 'string' } },
    browser_type: { description: 'Append text to element by ref', args: { ref: 'string (required)', text: 'string', viewId: 'string' } },
    browser_hover: { description: 'Hover element by ref', args: { ref: 'string (required)', viewId: 'string' } },
    browser_press_key: { description: 'Press keyboard key', args: { key: 'string (required)', viewId: 'string' } },
    browser_scroll: {
        description: 'Scroll page or element',
        args: {
            viewId: 'string', ref: 'string', direction: 'up|down|left|right',
            amount: 'number', deltaX: 'number', deltaY: 'number', scrollIntoView: 'boolean',
        },
    },
    browser_select_option: {
        description: 'Select option(s) in a select element',
        args: { ref: 'string (required)', values: 'string[] (required)', viewId: 'string' },
    },
    browser_drag: {
        description: 'Drag sourceRef to targetRef or coordinates',
        args: { sourceRef: 'string (required)', targetRef: 'string', targetX: 'number', targetY: 'number', viewId: 'string' },
    },
    browser_get_bounding_box: { description: 'Element bounding box by ref', args: { ref: 'string (required)', viewId: 'string' } },
    browser_highlight: { description: 'Highlight element briefly', args: { ref: 'string (required)', durationMs: 'number', viewId: 'string' } },
    browser_mouse_click_xy: {
        description: 'Click at viewport coordinates',
        args: { x: 'number (required)', y: 'number (required)', button: 'left|right|middle', viewId: 'string' },
    },
    browser_cdp: {
        description: 'Chrome DevTools Protocol command',
        args: { method: 'string (required)', params: 'object', viewId: 'string' },
    },
    browser_screenshot: { description: 'Screenshot (alias: browser_take_screenshot)', args: { viewId: 'string', type: 'string' } },
    browser_take_screenshot: { description: 'Alias of browser_screenshot', args: { viewId: 'string', type: 'string' } },
    browser_tabs: { description: 'List open browser tabs', args: {} },
    browser_lock: { description: 'Lock browser tab', args: { viewId: 'string' } },
    browser_unlock: { description: 'Unlock browser tab', args: { viewId: 'string' } },
    browser_close_tab: { description: 'Close browser tab', args: { viewId: 'string (required)' } },
    browser_navigate_back: { description: 'History back + snapshot', args: { viewId: 'string' } },
    browser_navigate_forward: { description: 'History forward + snapshot', args: { viewId: 'string' } },
    browser_reload: { description: 'Reload page', args: { viewId: 'string' } },
    browser_console_messages: { description: 'Console log output', args: { viewId: 'string' } },
    browser_network_requests: { description: 'Network request log', args: { viewId: 'string' } },
    browser_resize: { description: 'Resize browser viewport', args: { viewId: 'string', width: 'number', height: 'number' } },
    browser_evaluate: { description: 'Execute JavaScript', args: { script: 'string (required)', viewId: 'string' } },
    browser_design_enable: { description: 'Enable mockup mode (drag handles, orange outlines)', args: { viewId: 'string' } },
    browser_design_disable: { description: 'Disable mockup mode', args: { viewId: 'string' } },
    browser_design_duplicate: {
        description: 'Duplicate a DOM element (Odoo app tile, etc.) for mockup',
        args: {
            viewId: 'string', ref: 'string', id: 'string', selector: 'string',
            cursorElementId: 'string', domPath: 'string', label: 'string',
            float: 'boolean', cloneWrapper: 'boolean', offsetX: 'number', offsetY: 'number',
        },
    },
    browser_design_add_container: {
        description: 'Add draggable image/text container for page mockup',
        args: {
            viewId: 'string', imageUrl: 'string', label: 'string', width: 'number', height: 'number',
            left: 'number', top: 'number', parentSelector: 'string', background: 'string',
        },
    },
    browser_design_list: { description: 'List mockup elements on page', args: { viewId: 'string' } },
    browser_design_remove: { description: 'Remove mockup element by id', args: { id: 'string (required)', viewId: 'string' } },
    browser_design_move: { description: 'Move mockup element to viewport x/y', args: { id: 'string (required)', left: 'number', top: 'number', viewId: 'string' } },
};

const REST_ROUTES = [
    { method: 'GET', path: '/health', description: 'Bridge health check' },
    { method: 'GET', path: '/tools', description: 'List tool names and arg schemas' },
    { method: 'GET', path: '/tabs', description: 'List browser tabs (shortcut)' },
    { method: 'GET', path: '/snapshot', description: 'Snapshot; query: viewId, interactive' },
    { method: 'GET', path: '/url', description: 'Current tab URL; query: viewId' },
    { method: 'GET', path: '/title', description: 'Current tab title; query: viewId' },
    { method: 'GET', path: '/debug/tabs', description: 'Debug tab + agent state' },
    { method: 'GET', path: '/debug/commands', description: 'Cursor browser/agent command names' },
    { method: 'POST', path: '/navigate', description: 'Body: { url, newTab?, viewId? }' },
    { method: 'POST', path: '/close-tab', description: 'Body: { viewId }' },
    { method: 'POST', path: '/wait-for', description: 'Body: { host?, urlContains?, ref?, text?, timeoutMs?, viewId? }' },
    { method: 'POST', path: '/odoo-login', description: 'Body: { stack?, loginUrl?, publicUrl?, newTab?, credentials? }' },
    { method: 'POST', path: '/design/enable', description: 'Enable page mockup mode (drag, outlines)' },
    { method: 'POST', path: '/design/disable', description: 'Disable mockup mode' },
    { method: 'POST', path: '/design/duplicate', description: 'Duplicate element: { id|ref|selector|cursorElementId|domPath, label?, float? }' },
    { method: 'POST', path: '/design/container', description: 'Add image container: { imageUrl?, label?, width?, height?, left?, top? }' },
    { method: 'GET', path: '/design/list', description: 'List mockup elements; query: viewId' },
    { method: 'POST', path: '/design/remove', description: 'Body: { id, viewId? }' },
    { method: 'POST', path: '/design/move', description: 'Body: { id, left, top, viewId? }' },
    { method: 'POST', path: '/register-script-session', description: 'Create/discover ownerAgentId' },
    { method: 'POST', path: '/tool', description: 'Body: { name, args }' },
];

module.exports = { TOOL_SCHEMAS, REST_ROUTES };
