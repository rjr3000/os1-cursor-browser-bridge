#!/usr/bin/env bash
# Uninstall os1 Cursor Browser Bridge from Cursor extensions dir.
set -euo pipefail

for base in "${HOME}/.cursor-server/extensions" "${HOME}/.cursor/extensions"; do
  [ -d "${base}" ] || continue
  for dir in "${base}"/local.os1-cursor-browser-bridge "${base}"/local.os1-cursor-browser-bridge-*; do
    if [ -d "${dir}" ]; then
      echo "==> Removing ${dir}"
      rm -rf "${dir}"
    fi
  done
  ext_json="${base}/extensions.json"
  if [ -f "${ext_json}" ]; then
    python3 - "${ext_json}" <<'PY'
import json, sys
path = sys.argv[1]
try:
    entries = json.load(open(path, encoding="utf-8"))
except json.JSONDecodeError:
    entries = []
new_entries = [e for e in entries if e.get("identifier", {}).get("id") != "local.os1-cursor-browser-bridge"]
if len(new_entries) != len(entries):
    json.dump(new_entries, open(path, "w", encoding="utf-8"))
    print(f"==> Removed os1 entry from {path}")
PY
  fi
done

rm -f /tmp/cursor-browser-bridge-port
echo "==> Done. Reload Cursor: Ctrl+Shift+P → Developer: Reload Window"
