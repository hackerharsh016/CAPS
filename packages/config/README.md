# @caps/config

Shared TypeScript, ESLint, and Prettier configurations for the CAPS monorepo.

## Configurations Provided

- **TypeScript:**
  - `tsconfig.base.json`: Strict baseline configuration (`ES2022`, `NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`).
  - `tsconfig.node.json`: Extension for Node.js backends and services.
  - `tsconfig.next.json`: Extension for Next.js web applications (`customer-web`, `owner-dashboard`).

- **ESLint:**
  - `eslint.base.js`: Base ESLint 9 flat config incorporating `@eslint/js` recommended and `typescript-eslint` recommended.
  - `eslint.node.js`: Extension for Node backend services (`apps/cloud-api`).
  - `eslint.next.js`: Extension for Next.js applications.

- **Prettier:**
  - `prettier.config.js`: Central code formatting rules (semi, single quotes, 100 character print width).

## Quality Gates

Run quality checks across all workspaces via Turborepo:
```bash
pnpm run format:check   # Prettier verification
pnpm run lint           # ESLint across all workspaces
pnpm run typecheck      # TypeScript tsc --noEmit across all workspaces
```
