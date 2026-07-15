# AI Instructions — Codespaces

## Working in this Codespace

This repo is **os1-cursor-browser-bridge** — Cursor Browser Bridge — browser automation for os1 stacks.

You are running in a GitHub Codespace with SSH access to the production VM (devops-1r).

## SSH to the VM

```bash
ssh vm  # connects to devops-1r as ubuntu@172.93.100.110
```

The SSH key is configured automatically by `.devcontainer/setup-ssh.sh` on Codespace creation.

## Deploy workflow

1. **Edit code** locally in the Codespace
2. **Commit and push**:
   ```bash
   git add <paths> && git commit -m "fix: ..." && git push origin main
   ```
3. **Deploy to VM**:
   ```bash
   bash .devcontainer/deploy-to-vm.sh
   ```
   This pulls the latest code on the VM. Customize with repo-specific deploy steps if needed.

4. **Verify** — run repo-specific verification commands via SSH:
   ```bash
   ssh vm 'cd /home/ubuntu/repos/os1-cursor-browser-bridge && docker compose ps'
   ssh vm 'curl -sI https://<your-domain>/ | head -3'
   ```

## VM repo path

The repo lives at `/home/ubuntu/repos/os1-cursor-browser-bridge` on the VM. The `VM_REPO_PATH` secret is set to this path.

## Things you CANNOT do from Codespaces

- Open a browser — use `curl` to verify HTTP responses
- Run Docker commands locally — Docker in the Codespace is not connected to the VM's Docker daemon. Run Docker commands via `ssh vm 'docker ...'`
- Access gitignored secret files — they only exist on the VM
