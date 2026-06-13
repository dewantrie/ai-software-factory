# 06 — Profiles

A profile is the opinionated rule pack for one stack. This chapter explains what's in
one, the one counter-intuitive thing about how they're consumed, and the least-privilege
principle behind their path defaults.

## Anatomy of a profile

Open `profiles/node-fastify.md`. A profile is plain markdown with these parts:

- **Stack assumptions** — the versions and libraries it presumes (Node 20, Fastify 4,
  Prisma/Drizzle, Vitest…).
- **Architecture rules** — "business logic in `src/services/`, handlers stay thin",
  "money is integer cents", "tenant-scope every query".
- **Don't-do list** — "no raw SQL", "no `any` outside fixtures", "don't log request
  bodies on auth routes".
- **Conventions** — file naming, import style, test file naming.
- **Default paths** and **Default commands** — YAML blocks (see the trap below).

The profile **body** is inlined verbatim into the generated context file under
`## Profile rules`. So when you write a profile, structure it as a self-contained section
— its `## Architecture rules` heading ends up nested under `## Profile rules` in
`CLAUDE.md`.

## The trap: "Default paths/commands" are documentation only

This catches everyone once. The `Default paths` and `Default commands` YAML blocks in a
profile are **not** read during `factory install`. The render pipeline pulls paths and
commands from the **manifest**, never from the profile.

So what are they for? Exactly two things:

1. `factory init` parses them (`src/util/profile-defaults.ts`, via a regex that finds the
   ```` ```yaml ```` block after the `## Default …` heading) to **pre-fill** a new
   manifest.
2. A human copying a profile sees a sane starting point.

Mental model: **the profile suggests; the manifest decides.** If you change a profile's
default paths, nothing happens to existing repos until someone re-runs `init` or copies
the values into a manifest. (This indirection is a known sharp edge — see Chapter
[09](09-design-decisions.md).)

## Least-privilege path defaults

The `paths` keys in a profile map to agents (Chapter [04](04-path-enforcement.md)), and
the defaults are written for **least privilege**: each agent owns its domain, with as
little overlap as the stack allows.

The clearest example is migrations. Earlier, schema/migration globs lived under
`backend`, so the backend builder could rewrite migrations. The profiles now put them
under a dedicated `migrations` key:

```yaml
# node-fastify.md
paths:
  backend:     [src/routes/**, src/services/**, src/repository/**, src/lib/**]
  migrations:  [prisma/**, drizzle/**]      # migration-author owns schema, not backend
  infra:       [Dockerfile, docker-compose*.yml, .github/workflows/**]
  tests:       [tests/integration/**, tests/fixtures/**]
  docs:        [docs/**, CHANGELOG.md, README.md]
  forbidden:   [.env*, "**/secrets.*"]
```

The principle and its limits:

- **Move, don't duplicate.** A migration glob belongs under `migrations`, *removed* from
  `backend`, so the separation is real.
- **Don't orphan files.** Narrowing too aggressively can leave files owned by no agent
  (an early draft narrowed Quarkus `resources` so far it orphaned `META-INF/**` and seed
  data; the fix was to keep `backend` broad enough and let `migrations` be the *tighter*
  scope). When a clean split isn't expressible with simple globs, prefer a small overlap
  (broad backend + tight migrations) over orphaning real files.
- **Frontend/library profiles have no `migrations`** — a React SPA or a published library
  has no schema, so that agent stays opt-out there.

## Why profiles are markdown, not config

A profile could have been a JSON/YAML config. It's markdown because most of its value —
the architecture rules and don't-dos — is **prose the AI reads**, inlined straight into
the context file. Keeping it as one human-authored document means the thing you edit is
the thing the agent reads; there's no translation layer to drift. The small structured
parts (default paths/commands) are extracted with a regex precisely so the prose stays
primary.

## Writing a new profile

Covered as a recipe in Chapter [08](08-extending.md), but the shape: copy an existing
profile, rewrite the four prose sections for your stack, and set least-privilege
`Default paths` following the table above. Then wire stack auto-detection in
`src/util/detect-stack.ts` if you want `factory init` to suggest it automatically.

Next: [07 — Cross-repo features](07-cross-repo.md).
