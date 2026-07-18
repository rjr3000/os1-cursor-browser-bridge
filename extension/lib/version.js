'use strict';

const fs = require('fs');
const path = require('path');

function readExtensionVersion() {
    try {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
        );
        return pkg.version || '0.0.0';
    } catch (_) {
        return '0.0.0';
    }
}

module.exports = { readExtensionVersion };
