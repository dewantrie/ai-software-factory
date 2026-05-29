# Profile: Bun + Hono + Drizzle (backend-only)

Stack assumptions:
- Bun 1.1+ (TypeScript runs natively — no separate build step)
- Hono 4 (web framework, Web-standard `Request` / `Response`)
- Drizzle ORM + PostgreSQL (Drizzle has first-class Bun support)
- BullMQ for background jobs (Redis-backed) — works on Bun via the Node-compatible API
- Pino or `bun:console` for structured logging
- `bun:test` for unit tests; httpx-style HTTP testing via Hono's `app.request()` helper for integration
- Biome for lint + format (Bun + Biome is a common pairing) — swap for ESLint if your repo uses it

## Architecture rules

- Business logic lives in `src/services/`. Route handlers (`src/routes/`) stay thin — validate input, call service, return the result.
- Every database query touching tenant data MUST be scoped by `tenantId`. Drizzle: pass `tenantId` into the where clause; do not rely on global / async-local context for tenancy.
- Background work goes through BullMQ. Do NOT spawn long-running async work inside request handlers.
- UTC everywhere; convert at the API boundary.
- Money is integer cents.
- Errors use typed error classes (define a base `AppError` in `src/lib/errors.ts` and subclass per domain). Raw `throw new Error(...)` is forbidden in production paths.
- IDs are server-generated UUIDs (`crypto.randomUUID()` is available natively on Bun — no library needed).
- Every endpoint validates input with `zod` + Hono's `@hono/zod-validator` middleware before use. Never accept raw `c.req.json()` payloads without validation.
- All responses follow `{ data }` or `{ error: { code, message } }` shape.
- Use Hono's `c.json()` helper; do not construct `Response` objects manually for the common path.

## Don't do

- Do not add cron in-process — use BullMQ.
- Do not use `setTimeout` / `setInterval` for scheduled work — use the queue.
- Do not log raw request bodies for billing or auth routes.
- Do not write raw SQL outside of Drizzle's escape hatches.
- Do not import Node-only APIs that Bun does not implement (rare in practice, but check Bun's compat table if you see "not implemented" errors).
- Do not import from `node:` modules where a Web standard exists (use `fetch` over `node:http`, `crypto.subtle` over `node:crypto` where applicable).
- Do not store state in memory between requests (multi-instance deploy).
- Do not catch and swallow errors silently.
- Do not use `any` outside of test fixtures.
- Do not commit `.env`, `.key`, `.pem`, or `secrets.*` files.
- Do not commit `bun.lockb` if a `package-lock.json` already exists (or vice versa) — pick one lockfile per repo.

## Conventions

- File naming: kebab-case (`invoice.service.ts`)
- Test files: `foo.ts` → `foo.test.ts` next to the code
- Integration tests live under `tests/integration/`
- Imports: absolute via `@/` prefix (configure in `tsconfig.json` paths)
- One default export per file; named exports otherwise
- Hono routes grouped per resource in `src/routes/<resource>.ts`, mounted in `src/app.ts`

## Default paths (override in manifest)

```yaml
paths:
  backend:
    - src/routes/**
    - src/services/**
    - src/repository/**
    - src/lib/**
    - src/db/**              # Drizzle schema + migrations
  frontend: []               # backend-only
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
  typecheck: bunx tsc --noEmit
  lint: bunx biome check .
  test: bun test
  acceptance: bun test tests/integration
```
