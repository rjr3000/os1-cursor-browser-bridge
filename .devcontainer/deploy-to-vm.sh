#!/usr/bin/env bash
# Deploy changes from Codespaces to the VM via SSH.
# Pulls latest code on the VM from the main/master branch.
# Customize this script with repo-specific deploy steps (docker compose, etc.)
set -euo pipefail

VM_REPO_PATH="${VM_REPO_PATH:-/home/ubuntu/repos/$(basename $(git rev-parse --show-toplevel))}"

# Detect default branch
BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
BRANCH="${BRANCH:-main}"

echo "[deploy] Pulling ${BRANCH} on VM at ${VM_REPO_PATH}..."
ssh vm "cd ${VM_REPO_PATH} && git pull origin ${BRANCH}" 2>&1

echo "[deploy] Done. Customize this script with repo-specific deploy steps if needed."
