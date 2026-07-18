#!/usr/bin/env bash
# Install os1 Cursor Browser Bridge extension into Cursor extensions dir.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_SRC="${SCRIPT_DIR}/extension"
EXT_ID="local.os1-cursor-browser-bridge"
EXT_FOLDER="${EXT_ID}"

if [ ! -f "${EXT_SRC}/extension.js" ]; then
  echo "ERROR: missing ${EXT_SRC}/extension.js"
  exit 1
fi

EXT_BASES=()
if [ -d "${HOME}/.cursor-server/extensions" ]; then
  EXT_BASES+=("${HOME}/.cursor-server/extensions")
fi
if [ -d "${HOME}/.cursor/extensions" ]; then
  EXT_BASES+=("${HOME}/.cursor/extensions")
fi
if [ "${#EXT_BASES[@]}" -eq 0 ]; then
  echo "ERROR: Cursor extensions directory not found (~/.cursor/extensions or ~/.cursor-server/extensions)"
  exit 1
fi

register_extension() {
  local base="$1"
  local ext_dir="$2"
  local ext_json="${base}/extensions.json"
  python3 - "${ext_json}" "${ext_dir}" "${EXT_FOLDER}" <<'PY'
import json, os, sys
ext_json, ext_dir, rel = sys.argv[1:4]
version = "0.0.0"
pkg = os.path.join(ext_dir, "package.json")
if os.path.isfile(pkg):
    version = json.load(open(pkg, encoding="utf-8")).get("version", version)
entries = []
if os.path.isfile(ext_json):
    try:
        entries = json.load(open(ext_json, encoding="utf-8"))
    except json.JSONDecodeError:
        entries = []
entries = [e for e in entries if e.get("identifier", {}).get("id") != "local.os1-cursor-browser-bridge"]
entries.append({
    "identifier": {"id": "local.os1-cursor-browser-bridge"},
    "version": version,
    "location": {
        "$mid": 1,
        "fsPath": ext_dir,
        "external": f"file://{ext_dir}",
        "path": ext_dir,
        "scheme": "file",
    },
    "relativeLocation": rel,
})
with open(ext_json, "w", encoding="utf-8") as fh:
    json.dump(entries, fh)
print(f"==> Registered {rel} v{version} in {ext_json}")
PY
}

for base in "${EXT_BASES[@]}"; do
  for stale in "${base}"/local.os1-cursor-browser-bridge-*; do
    if [ -d "${stale}" ]; then
      echo "==> Removing stale ${stale}"
      rm -rf "${stale}"
    fi
  done
  EXT_DIR="${base}/${EXT_FOLDER}"
  echo "==> Installing os1 Cursor Browser Bridge to ${EXT_DIR}"
  mkdir -p "${EXT_DIR}/lib"
  cp "${EXT_SRC}/package.json" "${EXT_SRC}/extension.js" "${EXT_SRC}/snapshot.js" "${EXT_DIR}/"
  cp "${EXT_SRC}/lib/"*.js "${EXT_DIR}/lib/"
  register_extension "${base}" "${EXT_DIR}"
done

echo "==> Done."
echo ""
echo "Remote SSH: extension runs on Linux VM only (workspace host)."
echo ""
echo "If you still see a spinning 'os1 Mockup' tab next to Terminal on Windows,"
echo "that is a STALE local UI extension — remove it on your PC:"
echo "  PowerShell: Remove-Item -Recurse -Force \$env:USERPROFILE\\.cursor\\extensions\\local.os1-cursor-browser-bridge*"
echo "  Or run: bash uninstall.sh   (on Windows, in this repo)"
echo "Then: Ctrl+Shift+P → Developer: Reload Window"
echo "Close any leftover tab: bottom panel → right-click 'os1 Mockup' → Close"
echo ""
echo "Verify on VM after reload:"
echo "  curl -s http://127.0.0.1:\$(cat /tmp/cursor-browser-bridge-port)/health"
echo "  login live2"
