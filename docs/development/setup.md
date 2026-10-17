# CAPS — Developer Setup Guide

> **Document:** `docs/development/setup.md`  
> **Status:** Active Reference  
> **Target Audience:** All CAPS Engineers & Contributors

---

## 1. System Prerequisites

Before contributing to CAPS, verify that your workstation has the following core toolchains installed:

| Tool | Required Version | Purpose |
|---|---|---|
| **Node.js** | `>= 20.0.0` (Node 22 LTS recommended) | Runtime for Web Apps (`customer-web`, `owner-dashboard`) & `cloud-api` |
| **pnpm** | `10.26.2` (or `>= 9.0.0`) | Monorepo package manager & workspace dependency link resolution |
| **Python** | `>= 3.11` (Python 3.12/3.14 verified) | Desktop Print Agent (`apps/print-agent`) on Windows |
| **Git** | `>= 2.40.0` | Source control |
| **Windows OS** | Windows 10/11 x64 (recommended) | Required for physical Win32 print spooler and hardware driver testing |
| **Supabase CLI** | Optional for local DB | Local Postgres, Auth, and Storage emulator |

---

## 2. Initial Repository Bootstrap

### Step 1: Clone the Repository
```bash
git clone <repository-url> CAPS
cd CAPS
```

### Step 2: Configure Workspace Packages
Enable Corepack and install all Node.js workspace dependencies:
```bash
corepack enable
pnpm install
```

### Step 3: Configure Environment Variables
Copy the master environment template:
```bash
cp .env.example .env
```
Open `.env` and fill in local development credentials. Notice that `.env` is ignored by Git to prevent secret leaks. Refer to [`docs/development/environment-matrix.md`](file:///D:/CAPS%20REPO/CAPS/docs/development/environment-matrix.md) for variable specifications.

### Step 4: Set Up the Python Print Agent Virtual Environment
The Windows Print Agent (`apps/print-agent`) operates as an independent Python package:
```powershell
cd apps/print-agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
pip install jsonschema pytest ruff
cd ../..
```

---

## 3. Verifying Your Local Environment

Run the following checks from the repository root:

```bash
# 1. Check code style and formatting across all workspaces
pnpm run format:check

# 2. Run TypeScript compiler typechecks across all packages
pnpm run typecheck

# 3. Run ESLint checks across TypeScript workspaces
pnpm run lint

# 4. Run automated test suites (API, Customer Web, Owner Dashboard, Validation, Contracts)
pnpm run test

# 5. Build all workspace applications and libraries
pnpm run build

# 6. Run Python Print Agent test suites
$env:PYTHONPATH = "apps/print-agent/src"
python -m unittest discover -s apps/print-agent/tests -p "test_*.py" -v
```

If all commands complete with zero errors, your workstation is fully configured for CAPS development.
