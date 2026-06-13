# Profile: Python + FastAPI + SQLAlchemy (backend-only)

Stack assumptions:
- Python 3.12+
- FastAPI
- SQLAlchemy 2 + Alembic + PostgreSQL
- Celery or RQ for background jobs (Redis-backed)
- Pydantic v2 for request/response models
- pytest + httpx for tests
- ruff for lint, mypy for typecheck

## Architecture rules

- Business logic lives in `app/services/`. Routers (`app/routers/`) stay thin — validate input via Pydantic, call service, return response model.
- Every query touching tenant data MUST be scoped by `tenant_id`.
- Background work goes through Celery/RQ.
- UTC everywhere; convert at the API boundary.
- Money is integer cents.
- Errors: define `AppError` base class in `app/exceptions.py`, subclass per domain. Production paths must NOT raise bare `Exception(...)` to clients.
- IDs are server-generated UUIDs (`uuid.uuid4()`).
- Every endpoint uses Pydantic models for input and output — never accept raw dicts at the boundary.

## Don't do

- Do not add cron in-process — use Celery beat or RQ scheduler.
- Do not log sensitive payloads.
- Do not introduce new dependencies without approval.
- Do not write raw SQL — use SQLAlchemy ORM or Core.
- Do not use mutable default arguments.
- Do not catch `Exception` broadly — be specific.
- Do not commit `.env`, credentials, or `*.pem`.

## Conventions

- File naming: snake_case (`invoice_service.py`)
- Class naming: PascalCase
- Function naming: snake_case
- Test files: `foo.py` → `tests/unit/test_foo.py` (or co-located depending on team)
- Type hints required on every public function

## Default paths (override in manifest)

```yaml
paths:
  backend:
    - app/routers/**
    - app/services/**
    - app/models/**
    - app/schemas/**
    - app/db/**
  frontend: []           # backend-only
  migrations:            # Migration Author owns Alembic migrations + config
    - alembic/**
    - alembic.ini
  infra:                 # DevOps Builder owns CI/CD + container/IaC
    - Dockerfile
    - docker-compose*.yml
    - .github/workflows/**
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
  typecheck: mypy app
  lint: ruff check .
  test: pytest tests/unit
  acceptance: pytest tests/integration
```
