#!/usr/bin/env bash
# Uninstall os1 Cursor Browser Bridge from Cursor extensions dir.
set -euo pipefail

for base in "${HOME}/.cursor-server/extensions" "${HOME}/.cursor/extensions"; do
  for ver in 0.4.0 0.3.0 0.2.1; do
    EXT_NAME="local.os1-cursor-browser-bridge-${ver}"
    if [ -d "${base}/${EXT_NAME}" ]; then
      echo "==> Removing ${base}/${EXT_NAME}"
      rm -rf "${base}/${EXT_NAME}"
    fi
  done
done

rm -f /tmp/cursor-browser-bridge-port
echo "==> Done. Reload Cursor: Ctrl+Shift+P → Developer: Reload Window"
