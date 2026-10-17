# CAPS — Operational Runbooks & Startup Commands

> **Document:** `docs/development/runbooks.md`  
> **Status:** Active Reference  
> **Target Audience:** All CAPS Engineers & Operations Staff

---

## 1. Local Development Runbooks

### Runbook 1.1: Starting the Entire Monorepo
To launch all services concurrently in development mode:

```bash
# Terminal 1: Start Cloud API and Web Apps via Turborepo
pnpm dev

# Terminal 2: Start Desktop Print Agent (Windows)
cd apps/print-agent
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = "src"
$env:CAPS_AGENT_CLOUD_API_URL = "http://127.0.0.1:4000"
$env:CAPS_AGENT_REALTIME_URL = "ws://127.0.0.1:54321/realtime/v1/websocket"
$env:CAPS_AGENT_SHOP_ID = "00000000-0000-0000-0000-000000000001"
$env:CAPS_AGENT_DEVICE_TOKEN = "dev-agent-token-test-001"
python src/caps_agent/main.py
```

### Runbook 1.2: Running Independent Application Workspaces
To work on a single application in isolation:

```bash
# Start only Cloud API Fastify server (Port 4000)
pnpm --filter @caps/cloud-api dev

# Start Customer Web App (Next.js, Port 3000)
pnpm --filter @caps/customer-web dev

# Start Owner Dashboard (Next.js, Port 3001)
pnpm --filter @caps/owner-dashboard dev
```

---

## 2. Quality & CI Verification Runbook

Run these commands before pushing any code to maintain repository release readiness:

```bash
# 1. Format check across all files
pnpm run format:check

# 2. Automated format write (if format:check flags unformatted files)
pnpm run format:write

# 3. Type checking across all TypeScript workspaces
pnpm run typecheck

# 4. ESLint verification across TypeScript packages
pnpm run lint

# 5. Full test suite execution across TypeScript workspaces
pnpm run test

# 6. Production build verification
pnpm run build

# 7. Python Print Agent unit & contract test suite
cd apps/print-agent
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = "src"
python -m unittest discover -s tests -p "test_*.py" -v
cd ../..
```

---

## 3. Troubleshooting & Recovery Runbooks

### Runbook 3.1: Python `ModuleNotFoundError: No module named 'caps_agent'`
- **Cause:** Python cannot locate the `src` layout package when executing tests or commands from outside `apps/print-agent`.
- **Resolution:** Set the `PYTHONPATH` environment variable to include `apps/print-agent/src`:
  - **PowerShell:** `$env:PYTHONPATH = "apps/print-agent/src"`
  - **Bash / Linux:** `export PYTHONPATH="apps/print-agent/src"`

### Runbook 3.2: Print Agent Security Error: `ConfigurationError: Loopback security violation`
- **Cause:** `CAPS_AGENT_LOCAL_BIND` was set to `0.0.0.0` or a public IP address.
- **Resolution:** Reset `CAPS_AGENT_LOCAL_BIND = "127.0.0.1"` in your `.env` or environment. For security reasons, the agent loopback server will never accept external bindings.

### Runbook 3.3: Port Already in Use (Ports 3000, 3001, 4000, 7890)
- **Check listening processes (PowerShell):**
  ```powershell
  Get-NetTCPConnection -LocalPort 4000, 3000, 3001, 7890 -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
  ```
- **Terminate orphaned node/python process:**
  ```powershell
  Stop-Process -Id <OwningProcessId> -Force
  ```

### Runbook 3.4: Rebuilding Workspace Links
If packages fail to resolve shared packages (e.g. `@caps/types` or `@caps/validation`):
```bash
# Clean all workspace builds and node_modules
pnpm run clean
# Reinstall and re-link
pnpm install
# Rebuild shared packages in dependency order
pnpm run build
```
