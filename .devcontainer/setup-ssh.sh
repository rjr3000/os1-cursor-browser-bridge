#!/usr/bin/env bash
# Sets up SSH access to the devops-1r VM from GitHub Codespaces.
# Secrets VM_SSH_PRIVATE_KEY, VM_HOST, VM_USER are injected as env vars.
set -euo pipefail

SSH_DIR="${HOME}/.ssh"
KEY_FILE="${SSH_DIR}/id_ed25519_vm"
SSH_CONFIG="${SSH_DIR}/config"

mkdir -p "${SSH_DIR}"
chmod 700 "${SSH_DIR}"

# Write the private key if the secret is present
if [ -n "${VM_SSH_PRIVATE_KEY:-}" ]; then
  printf '%s\n' "${VM_SSH_PRIVATE_KEY}" > "${KEY_FILE}"
  chmod 600 "${KEY_FILE}"
  echo "[setup-ssh] Private key written to ${KEY_FILE}"
else
  echo "[setup-ssh] WARNING: VM_SSH_PRIVATE_KEY secret not set — SSH to VM will not work"
  exit 0
fi

# SSH config for the VM
VM_HOST_VAL="${VM_HOST:-172.93.100.110}"
VM_USER_VAL="${VM_USER:-ubuntu}"

cat > "${SSH_CONFIG}" <<EOF
Host vm
  HostName ${VM_HOST_VAL}
  User ${VM_USER_VAL}
  IdentityFile ${KEY_FILE}
  StrictHostKeyChecking accept-new
  ServerAliveInterval 60
  ServerAliveCountMax 3
EOF
chmod 600 "${SSH_CONFIG}"

echo "[setup-ssh] SSH config written — use 'ssh vm' to connect"
echo "[setup-ssh] VM repo path: ${VM_REPO_PATH:-/home/ubuntu/repos/axo.news}"

# Test the connection
echo "[setup-ssh] Testing SSH connection..."
if ssh -o ConnectTimeout=10 vm 'echo SSH_CONNECTION_OK' 2>&1; then
  echo "[setup-ssh] SSH connection to VM verified"
else
  echo "[setup-ssh] WARNING: SSH connection test failed — check secrets and VM authorized_keys"
fi
