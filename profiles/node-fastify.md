# Profile: Node + TypeScript + Fastify (backend-only)

Stack assumptions:
- Node 20+
- TypeScript strict mode
- Fastify 4
- Prisma 5 or Drizzle + PostgreSQL
- BullMQ for background jobs (Redis-backed)
- Pino for logging
- Vitest for unit tests, supertest/undici for integration

## Architecture rules

- Business logic lives in `src/services/`. Route handlers (`src/routes/`) stay thin — validate input, call service, return JSON.
- Every database query touching tenant data MUST be scoped by `tenantId`. No exceptions.
- Background work goes through BullMQ.
- UTC everywhere; convert at the API boundary.
- Money is integer cents.
- Errors use typed error classes in `src/lib/errors.ts`. Raw `throw new Error(...)` is forbidden in production paths.
- Server-generated UUIDs for entity IDs.
- Every endpoint validates input with Zod (or similar) before use.
- All responses follow `{ data }` or `{ error: { code, message } }`.

## Don't do

- Do not add cron — use BullMQ.
- Do not log raw request bodies for billing or auth routes.
- Do not introduce new external dependencies without approval.
- Do not write raw SQL — use the ORM.
- Do not store state in memory between requests.
- Do not catch and swallow errors silently.
- Do not use `any` outside test fixtures.
- Do not commit `.env`, `.key`, `.pem`, `secrets.*`.

## Conventions

- File naming: kebab-case (`invoice.service.ts`)
- Test files: `foo.ts` → `foo.test.ts`
- Imports: absolute via `@/` prefix
- One default export per file; named exports otherwise

## Default paths (override in manifest)

```yaml
paths:
  backend:
    - src/routes/**
    - src/services/**
    - src/repository/**
    - src/lib/**
    - prisma/**          # or drizzle/
  frontend: []           # backend-only
  tests:
    - tests/integration/**
    - tests/fixtures/**
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
  acceptance: pnpm test:integration
```
