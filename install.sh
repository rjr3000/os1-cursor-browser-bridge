#!/usr/bin/env bash
# Install os1 Cursor Browser Bridge extension into Cursor extensions dir.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_SRC="${SCRIPT_DIR}/extension"
EXT_NAME="local.os1-cursor-browser-bridge-0.4.2"

if [ ! -f "${EXT_SRC}/extension.js" ]; then
  echo "ERROR: missing ${EXT_SRC}/extension.js"
  exit 1
fi

if [ -d "${HOME}/.cursor-server/extensions" ]; then
  EXT_DIR="${HOME}/.cursor-server/extensions/${EXT_NAME}"
elif [ -d "${HOME}/.cursor/extensions" ]; then
  EXT_DIR="${HOME}/.cursor/extensions/${EXT_NAME}"
else
  echo "ERROR: Cursor extensions directory not found (~/.cursor/extensions or ~/.cursor-server/extensions)"
  exit 1
fi

echo "==> Installing os1 Cursor Browser Bridge to ${EXT_DIR}"
mkdir -p "${EXT_DIR}/lib"
cp "${EXT_SRC}/package.json" "${EXT_SRC}/extension.js" "${EXT_SRC}/snapshot.js" "${EXT_DIR}/"
cp "${EXT_SRC}/lib/"*.js "${EXT_DIR}/lib/"

echo "==> Done."
echo ""
echo "Next:"
echo "  1. Reload Cursor: Ctrl+Shift+P → Developer: Reload Window"
echo "  2. Output panel → Browser Bridge → confirm HTTP server started"
echo "  3. Test: curl -s http://127.0.0.1:\$(cat /tmp/cursor-browser-bridge-port)/health"
echo "  4. curl -s http://127.0.0.1:\$(cat /tmp/cursor-browser-bridge-port)/tools | head"
