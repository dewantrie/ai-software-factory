# Profile: Next.js App Router + Prisma

Stack assumptions:
- Next.js 14+ (App Router)
- TypeScript strict mode
- Prisma 5 + PostgreSQL
- BullMQ for background jobs (Redis-backed)
- React 18 + Tailwind + shadcn/ui
- NextAuth / Auth.js for authentication
- Vitest for unit tests, Playwright for acceptance

## Architecture rules

- Business logic lives in `src/services/`. API routes (`src/app/api/`) stay thin — parse input, call service, return response.
- Every database query that touches tenant data MUST be scoped by `tenantId`. No exceptions.
- Background work goes through BullMQ, never inline in request handlers.
- Time is always stored in UTC. Convert at the display boundary only.
- Money is stored as integer cents, never floats.
- Errors thrown from services must use the typed error classes in `src/lib/errors.ts`. Raw `throw new Error(...)` is forbidden in production paths.
- IDs are UUIDs (v4) generated server-side. Never trust client-provided IDs.
- All API responses validated against a Zod schema before sending. Shape: `{ data }` or `{ error: { code, message } }`.
- Server Components by default. `'use client'` only when interactivity requires it.

## Don't do

- Do not add cron — use BullMQ.
- Do not log raw request bodies for `/api/billing/*` or `/api/auth/*` routes.
- Do not introduce new external dependencies without an approved spec.
- Do not write raw SQL — use Prisma.
- Do not store state in memory between requests (multi-instance deploy).
- Do not catch and swallow errors silently.
- Do not use `any` outside of test fixtures.
- Do not commit `.env`, `.key`, `.pem`, or `secrets.*` files.

## Conventions

- File naming: kebab-case (`invoice-reminder.service.ts`)
- Component naming: PascalCase files (`InvoiceCard.tsx`)
- Test files: `foo.ts` → `foo.test.ts` (unit); acceptance tests under `tests/acceptance/`
- Imports: absolute via `@/` prefix
- One default export per file; named exports for everything else

## Default paths (override in manifest)

```yaml
paths:
  backend:
    - src/app/api/**
    - src/services/**
    - src/server/**
    - src/lib/server/**
  frontend:
    - src/app/**          # excluding src/app/api/**
    - src/components/**
    - src/hooks/**
    - src/lib/client/**
  migrations:            # Migration Author owns the Prisma schema + migrations
    - prisma/**
  infra:                 # DevOps Builder owns CI/CD + container/IaC
    - .github/workflows/**
    - Dockerfile
  tests:
    - tests/acceptance/**
    - tests/fixtures/**
  docs:                  # Doc Writer owns docs + changelog
    - docs/**
    - CHANGELOG.md
    - README.md
  forbidden:
    - .env*
    - "**/secrets.*"
```

## Default commands (override in manifest)

```yaml
commands:
  typecheck: pnpm typecheck
  lint: pnpm lint
  test: pnpm test
  acceptance: pnpm test:acceptance
```
