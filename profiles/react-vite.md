# Profile: React + Vite (single-app TypeScript frontend / SPA)

Stack assumptions:
- Node 20+, pnpm 9+
- React 19 (use the React Compiler if the build enables it)
- Vite 6 for dev server + build (Rollup under the hood)
- TypeScript in strict mode
- React Router 7 for client routing
- TanStack Query (`@tanstack/react-query`) for server state
- Zustand for client / UI state
- react-hook-form + Zod for forms
- Tailwind CSS 4 + shadcn/ui for styling
- Vitest + Testing Library (`@testing-library/react`, jsdom) for unit + integration tests
- Biome for lint + format (NOT ESLint / Prettier)
- API types generated from the backend's OpenAPI contract (e.g. `openapi-typescript`)

## Architecture rules

- Feature-based layout: `src/features/<feature>/{components,hooks,stores,types,index.ts}`. Cross-feature imports go through a feature's `index.ts`, never deep into its internals.
- Server state goes through TanStack Query. Do NOT use raw `useEffect + fetch` for data fetching.
- Client / UI state goes through Zustand stores (`*.store.ts`). Keep them per-feature.
- All network calls go through a single typed API client (`src/api/`). Components never call `fetch` directly.
- API request/response types are **generated from the backend contract** (OpenAPI), not hand-written. Treat `src/api/types.*` as generated — do not edit by hand.
- Forms use react-hook-form + Zod resolvers. Never roll your own form state.
- UI primitives come from shadcn/ui or `src/components/`. Keep one-off components in the consuming feature.
- Routes live in `src/features/<feature>/pages/` (or `src/pages/`), registered via React Router 7.
- Environment config is read from Vite env vars (`import.meta.env.VITE_*`) only; never hardcode endpoints.
- Accessibility: every interactive element keyboard-reachable; alt text on images; inputs have associated labels; focus visible; color is not the sole indicator of state.

## Don't do

- Do not add ESLint or Prettier — this stack uses Biome.
- Do not add Jest — this stack uses Vitest.
- Do not call `fetch` directly inside components — go through the typed API client.
- Do not hand-edit generated API types — regenerate them from the OpenAPI contract.
- Do not use `any` outside of test fixtures.
- Do not import server-only Node APIs into browser code (`fs`, `path`, Node `crypto`, …).
- Do not commit `.env`, `*.key`, `*.pem`, or anything resembling a secret.
- Do not commit `dist/` or `node_modules/`.

## Conventions

- File naming: kebab-case for files (`chat-panel.tsx`).
- React components: PascalCase identifiers in kebab-case files (shadcn convention).
- Hooks: `use-*.ts` files exporting `useFoo`.
- Stores: `*.store.ts` exporting a Zustand `useFooStore`.
- Test files: co-located, `*.test.ts(x)`.
- Imports order: external libs → `@/` alias (src root) → relative imports.

## Default paths (override in manifest)

```yaml
paths:
  backend: []                          # no backend in this repo type
  frontend:
    - src/**
  shared: []
  infra:                               # DevOps Builder owns CI/CD + container/IaC
    - .github/workflows/**
    - Dockerfile
  tests:
    - src/**/*.test.{ts,tsx}
  docs:                                # Doc Writer owns docs + changelog
    - docs/**
    - CHANGELOG.md
    - README.md
  forbidden:
    - node_modules/**
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
