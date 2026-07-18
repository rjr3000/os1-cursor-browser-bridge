'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Cross-platform port file (Windows: %TEMP%, Linux/macOS: /tmp). */
const PORT_FILE = path.join(os.tmpdir(), 'cursor-browser-bridge-port');

function writePortFile(port) {
    fs.mkdirSync(path.dirname(PORT_FILE), { recursive: true });
    fs.writeFileSync(PORT_FILE, String(port), 'utf8');
}

function readPortFile() {
    try {
        return fs.readFileSync(PORT_FILE, 'utf8').trim();
    } catch (_) {
        return '';
    }
}

function removePortFile() {
    try {
        fs.unlinkSync(PORT_FILE);
    } catch (_) { /* ignore */ }
}

module.exports = { PORT_FILE, writePortFile, readPortFile, removePortFile };
