'use strict';

function findRef(snapshotText, ...patterns) {
    for (const pat of patterns) {
        const esc = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = snapshotText.match(new RegExp(`"${esc}" \\[ref=([^\\]]+)\\]`));
        if (m) return m[1];
    }
    for (const line of snapshotText.split('\n')) {
        const lower = line.toLowerCase();
        for (const pat of patterns) {
            if (lower.includes(pat.toLowerCase()) && line.includes('[ref=')) {
                const m = line.match(/\[ref=([^\]]+)\]/);
                if (m) return m[1];
            }
        }
    }
    return null;
}

function snapshotUrl(snapshotText) {
    const m = snapshotText.match(/^URL:\s*(.+)$/m);
    return m ? m[1].trim() : null;
}

function toolText(result) {
    const parts = [];
    for (const item of result?.content || []) {
        if (item.type === 'text') parts.push(String(item.text || ''));
    }
    return parts.join('\n');
}

function toolMeta(result, key) {
    for (const item of result?.content || []) {
        if (item.type === 'metadata' && item[key]) return String(item[key]);
    }
    return null;
}

module.exports = { findRef, snapshotUrl, toolText, toolMeta };
