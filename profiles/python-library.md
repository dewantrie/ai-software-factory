# Profile: Python library (PyPI-publishable or internal-shared)

Stack assumptions:
- Python 3.11+
- `pyproject.toml` as the single source of truth (PEP 621)
- `src/<package>/` layout (the "src layout" — prevents accidental working-dir imports)
- pytest for tests
- ruff for lint + format
- mypy for typecheck (strict mode preferred)
- Type hints required on every public function
- Semver versioning
- Build backend: hatch, setuptools-pep621, or poetry-core — manifest commands swap accordingly

## Architecture rules

- The public API surface is defined explicitly in `src/<package>/__init__.py` via `__all__` (or curated re-exports). Adding to it is a backwards-compatible change; renaming or removing is a major version bump.
- Single responsibility per module. Break large files apart at the 500-line mark unless there's a strong reason (data classes, generated code).
- Every public function and class has a docstring (match the project's existing style — Google, numpy, or reST).
- Type hints are required on every public function, method, and module-level constant. `from __future__ import annotations` is allowed and encouraged on Python 3.10+.
- Tests live under `tests/`, mirroring the package structure (`tests/test_<module>.py`).
- Errors raise typed exceptions from `src/<package>/exceptions.py`. Base class `<Package>Error`. Subclass per failure mode. Bare `Exception` / `RuntimeError` are forbidden in production paths.
- Optional dependencies imported lazily inside the functions that need them — never at module top level if the dep is optional.
- Async-friendly where applicable: don't mix sync and async carelessly. If both are needed, expose a clearly named sync variant and async variant.
- Backwards compatibility: do not break the public API surface without a major version bump and a deprecation period of at least one minor release.

## Don't do

- Do not add new runtime dependencies without approval. Libraries are dependency-allergic — every transitive dep is foisted onto your consumers.
- Do not pin runtime dependencies to exact versions in `pyproject.toml`; use range constraints (`>=`, `~=`, or `>=X,<Y`).
- Do not commit virtual envs (`.venv`, `venv`, `env`).
- Do not catch bare `Exception` — be specific.
- Do not use `print()` for diagnostics in library code; use `logging`. The consumer configures sinks.
- Do not return `None` to signal failure — raise an exception.
- Do not depend on the consumer's working directory or environment variables in library code — accept everything as arguments.
- Do not commit `.env`, `*.key`, `*.pem`, `*.crt`, or anything resembling secrets.
- Do not generate module-level side effects on import (no network calls, file I/O, global state mutation).

## Conventions

- File naming: snake_case (`event_store.py`)
- Class naming: PascalCase
- Function and variable naming: snake_case
- Constants: UPPER_SNAKE_CASE
- Test files: `tests/test_<module>.py` mirroring `src/<package>/<module>.py`
- Import order: stdlib → third-party → first-party (the library's own modules), each group separated by a blank line
- Avoid `from foo import *`

## Default paths (override in manifest)

```yaml
paths:
  backend:                       # library logic — treat as "backend" for path scoping
    - src/**
  frontend: []                   # libraries don't have UIs
  infra:                         # DevOps Builder owns CI/CD (no container for a library)
    - .github/workflows/**
  tests:
    - tests/**
  docs:                          # Doc Writer owns docs + changelog
    - docs/**
    - CHANGELOG.md
    - README.md
  forbidden:
    - .env*
    - .venv/**
    - venv/**
    - env/**
    - dist/**
    - build/**
    - "**/*.egg-info/**"
    - "**/secrets.*"
    - "**/*.key"
    - "**/*.pem"
```

## Default commands (override in manifest)

```yaml
commands:
  typecheck: mypy src tests
  lint: ruff check . && ruff format --check .
  test: pytest
  # No separate acceptance command — library tests cover integration too.
```
