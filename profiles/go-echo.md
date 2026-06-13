# Profile: Go + Echo + sqlc (backend-only)

Stack assumptions:
- Go 1.22+
- Echo v4 (HTTP framework)
- sqlc + PostgreSQL (typed queries) — or GORM
- Asynq or River for background jobs (Redis-backed)
- slog for logging
- Standard library `testing` + testify for unit tests

## Architecture rules

- Business logic lives in `internal/services/`. Handlers (`internal/handlers/`) stay thin — bind input, call service, return JSON.
- Every database query touching tenant data MUST be scoped by `tenant_id`.
- Background work goes through the queue (Asynq/River).
- UTC everywhere; convert at the API boundary.
- Money is `int64` cents.
- Errors: define sentinel errors per domain in `internal/errors/`; wrap with `fmt.Errorf("...: %w", err)`. Production paths must NOT return raw `errors.New(...)` to clients.
- IDs are server-generated UUIDs (use `github.com/google/uuid`).
- Every handler validates input before use.
- `context.Context` is the first parameter of every function that does I/O.

## Don't do

- Do not add cron in-process — use the queue.
- Do not log sensitive payloads (tokens, payment data).
- Do not introduce new dependencies without approval.
- Do not write raw SQL outside of sqlc queries (or the equivalent ORM file).
- Do not use global state for request-scoped data — use `context.Context`.
- Do not ignore errors with `_`. Either handle or wrap.
- Do not commit `.env`, credential files, or `*.pem`.

## Conventions

- Package naming: lowercase, no underscores (`invoicesvc`, not `invoice_svc`)
- File naming: snake_case (`invoice_service.go`)
- Test files: `foo.go` → `foo_test.go`
- Exported names: PascalCase; unexported: camelCase

## Default paths (override in manifest)

```yaml
paths:
  backend:
    - internal/handlers/**
    - internal/services/**
    - internal/repository/**
    - internal/db/**
    - cmd/**
  frontend: []           # backend-only
  migrations:            # Migration Author owns migration files
    - db/migrations/**
  infra:                 # DevOps Builder owns CI/CD + container/IaC
    - Dockerfile
    - .github/workflows/**
    - deploy/**
  tests:
    - tests/integration/**
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
  typecheck: go build ./...   # go vet is a linter, not the compile/type gate; build is the real check
  lint: golangci-lint run
  test: go test ./... -race
  acceptance: go test ./tests/integration/... -tags=integration
```
