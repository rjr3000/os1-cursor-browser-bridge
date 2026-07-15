#!/usr/bin/env bash
# Sets up SSH access to the devops-1r VM and pulls secrets from Infisical.
# Secrets are injected as env vars by GitHub Codespaces.
set -euo pipefail

SSH_DIR="${HOME}/.ssh"
KEY_FILE="${SSH_DIR}/id_ed25519_vm"
SSH_CONFIG="${SSH_DIR}/config"

mkdir -p "${SSH_DIR}"
chmod 700 "${SSH_DIR}"

# --- SSH setup ---
if [ -n "${VM_SSH_PRIVATE_KEY:-}" ]; then
  printf '%s\n' "${VM_SSH_PRIVATE_KEY}" > "${KEY_FILE}"
  chmod 600 "${KEY_FILE}"
  echo "[setup] SSH private key written to ${KEY_FILE}"
else
  echo "[setup] WARNING: VM_SSH_PRIVATE_KEY not set — SSH to VM will not work"
fi

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
echo "[setup] SSH config written — use 'ssh vm' to connect"

# Test SSH connection
echo "[setup] Testing SSH connection..."
if ssh -o ConnectTimeout=10 vm 'echo SSH_OK' 2>&1; then
  echo "[setup] SSH connection verified"
else
  echo "[setup] WARNING: SSH test failed — check secrets and VM authorized_keys"
fi

# --- Infisical secrets pull ---
# If Infisical credentials are set, pull secrets and write to .env.local
if [ -n "${INFISICAL_CLIENT_ID:-}" ] && [ -n "${INFISICAL_CLIENT_SECRET:-}" ] && [ -n "${INFISICAL_PROJECT_ID:-}" ]; then
  echo "[setup] Pulling secrets from Infisical..."

  INFISICAL_DOMAIN_VAL="${INFISICAL_DOMAIN:-https://app.infisical.com}"
  INFISICAL_ENV_VAL="${INFISICAL_ENV:-prod}"
  INFISICAL_PATH_VAL="${INFISICAL_SECRET_PATH:-/}"

  # Exchange universal auth credentials for an access token
  TOKEN=$(curl -s -X POST "${INFISICAL_DOMAIN_VAL}/api/v1/auth/universal-auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"clientId\":\"${INFISICAL_CLIENT_ID}\",\"clientSecret\":\"${INFISICAL_CLIENT_SECRET}\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('accessToken',''))" 2>/dev/null || echo "")

  if [ -n "$TOKEN" ]; then
    # Pull secrets via v4 API
    SECRETS_JSON=$(curl -s "${INFISICAL_DOMAIN_VAL}/api/v4/secrets" \
      -H "Authorization: Bearer ${TOKEN}" \
      -G \
      -d "projectId=${INFISICAL_PROJECT_ID}" \
      -d "environment=${INFISICAL_ENV_VAL}" \
      -d "secretPath=${INFISICAL_PATH_VAL}" 2>/dev/null)

    # Write secrets to .env.local (gitignored)
    echo "$SECRETS_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
secrets = d.get('secrets', [])
with open('.env.local', 'w') as f:
    f.write('# Pulled from Infisical on Codespace creation\n')
    f.write(f'# Project: ${INFISICAL_PROJECT_ID}\n')
    f.write(f'# Env: ${INFISICAL_ENV_VAL}\n')
    f.write(f'# Path: ${INFISICAL_PATH_VAL}\n\n')
    for s in secrets:
        key = s.get('secretKey', '')
        val = s.get('secretValue', '')
        if key and val:
            f.write(f'{key}={val}\n')
print(f'[setup] Wrote {len(secrets)} secrets to .env.local')
" 2>&1

    echo "[setup] Infisical secrets pulled to .env.local"
  else
    echo "[setup] WARNING: Infisical auth failed — check INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET"
  fi
else
  echo "[setup] No Infisical project configured — skipping secrets pull"
  echo "[setup] Set INFISICAL_PROJECT_ID and INFISICAL_ENV secrets to enable"
fi
