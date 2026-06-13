# Profile: React + rsbuild + Module Federation (frontend-only, micro-frontend monorepo)

Stack assumptions:
- Node 20+, pnpm 9+
- React 19 (use React Compiler if the build enables it)
- rsbuild + Rspack for bundling
- Module Federation Enhanced for runtime composition of micro-frontends
- React Router 7 for client routing
- TanStack Query (`@tanstack/react-query`) for server state
- Zustand for client / UI state
- react-hook-form + Zod for forms
- Tailwind CSS 4 + shadcn/ui for styling
- Vitest + Testing Library (`@testing-library/react`, jsdom) for unit + integration tests
- Biome for lint + format (NOT ESLint / Prettier)
- Turborepo for monorepo task orchestration
- pnpm workspaces for package linking
- lefthook for git hooks

## Architecture rules

- Each app under `apps/<name>/` is a self-contained micro-frontend. Shared code lives in `packages/*` — never duplicated into another app's `src/`.
- Workspace imports use the scope prefix (e.g., `@atlas/<package>`). Cross-package relative imports (`../../packages/...`) are forbidden.
- One app is the host / shell; others are remotes exposed via Module Federation. The shell owns auth bootstrapping and routing composition.
- Server state goes through TanStack Query. Do NOT use raw `useEffect + fetch` for data fetching.
- Client state goes through Zustand stores. Co-locate per feature: `apps/<app>/src/features/<feature>/stores/`.
- Forms use react-hook-form + Zod resolvers. Never roll your own form state.
- UI primitives come from the shared UI package (e.g., `@atlas/ui-kit`) or shadcn. Custom one-offs live in the consuming app's `src/components/`.
- Routes live in `apps/<app>/src/pages/`, registered via React Router 7. Inter-app navigation contracts live in the shared `route-contracts` package.
- Auth tokens flow through the shared auth SDK. Do not call MSAL / OAuth APIs directly outside the host/shell.
- API calls go through the shared API client package. Do not call `fetch` directly inside components.
- Accessibility: every interactive element keyboard-reachable; alt text on images; form inputs have associated labels; focus visible; color not the sole indicator of state.

## Don't do

- Do not add ESLint or Prettier — this stack uses Biome.
- Do not add Jest — this stack uses Vitest.
- Do not create new top-level apps in `apps/` without explicit approval. The micro-frontend set is curated.
- Do not add a new package in `packages/` without a clear consumer and approval.
- Do not import across apps directly (e.g., from `apps/master-data` into `apps/user-management`). Communicate via the shared event bus or shared packages.
- Do not break Module Federation shared dependency versions. `react`, `react-dom`, and `react-router` (React Router 7's canonical package — not the deprecated `react-router-dom` re-export) must be shared as **singletons** (`shared: { react: { singleton: true }, ... }`); version drift or a non-singleton config causes runtime errors (duplicate React, mismatched router context across remotes).
- Do not commit `.env`, `*.key`, `*.pem`, or anything that would fail gitleaks.
- Do not bypass lefthook pre-commit hooks (lint, format, typecheck, gitleaks, branch-naming).
- Do not use `any` outside of test fixtures.
- Do not import server-only Node APIs into browser code (no `fs`, `crypto` (Node), `path`, etc.).

## Conventions

- File naming: kebab-case for files (`invoice-card.tsx`).
- React components: PascalCase identifiers in kebab-case filenames (shadcn convention).
- Hooks: `use-*.ts` files exporting `useFoo`.
- Stores: `*.store.ts` exporting a Zustand `useFooStore`.
- Test files: co-located, `*.test.ts(x)`.
- Feature-based organization within an app: `apps/<app>/src/features/<feature>/{components,hooks,stores,types,index.ts}`.
- Imports order: external libs → workspace packages → relative imports.

## Default paths (override in manifest)

```yaml
paths:
  backend: []                          # no backend in this repo type
  frontend:
    - apps/**/src/**
    - packages/*/src/**
  shared:
    - packages/types/**
    - packages/shared/**
    - packages/route-contracts/**
  infra:                               # DevOps Builder owns CI/CD + container/IaC
    - .github/workflows/**
    - Dockerfile
  tests:
    - apps/**/src/**/*.test.{ts,tsx}
    - packages/**/src/**/*.test.{ts,tsx}
  docs:                                # Doc Writer owns docs + changelog
    - docs/**
    - CHANGELOG.md
    - README.md
  forbidden:
    - node_modules/**
    - .turbo/**
    - dist/**
    - .env*
    - "**/secrets.*"
    - "**/*.key"
    - "**/*.pem"
```

## Default commands (override in manifest)

```yaml
commands:
  typecheck: pnpm typecheck
  lint: pnpm lint
  test: pnpm test
  # acceptance: omitted — Vitest covers unit + integration in one run
```
