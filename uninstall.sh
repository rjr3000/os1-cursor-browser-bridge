#!/usr/bin/env bash
# Uninstall os1 Cursor Browser Bridge from Cursor extensions dir.
set -euo pipefail

EXT_NAME="local.os1-cursor-browser-bridge-0.2.1"

for base in "${HOME}/.cursor-server/extensions" "${HOME}/.cursor/extensions"; do
  if [ -d "${base}/${EXT_NAME}" ]; then
    echo "==> Removing ${base}/${EXT_NAME}"
    rm -rf "${base}/${EXT_NAME}"
  fi
done

rm -f /tmp/cursor-browser-bridge-port
echo "==> Done. Reload Cursor: Ctrl+Shift+P → Developer: Reload Window"
