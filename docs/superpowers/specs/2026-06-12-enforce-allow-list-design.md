# Enforced per-agent allow-list path scoping

**Status:** Approved design — ready for implementation plan
**Date:** 2026-06-12
**Scope:** Claude Code adapter only (other platforms have no hook mechanism)

## Problem

The factory's headline promise is *"builders cannot touch files outside this list."*
Today that promise is only enforced for the `forbidden` list (a session-level
`PreToolUse` hook added in `feat(claude-code): real skill descriptions + enforced
path guard`, commit `ea23be7`). The **positive** allow-lists — what each builder
*may* edit — are still prompt-only: the agent is told its scope in `CLAUDE.md`
and trusted to obey. A builder that strays into another layer's files is not
blocked, only discouraged.

Two structural gaps make full enforcement impossible right now:

1. **No per-agent identity at the session level.** A single `settings.json`
   `PreToolUse` hook cannot tell *which* subagent is editing, so it cannot apply
   per-agent rules. That is why the existing guard only enforces the global
   `forbidden` list.
2. **Incomplete schema.** The manifest's `Paths` type only has
   `backend / frontend / shared / tests / forbidden`. The agents
   `migration-author`, `devops-builder`, and `doc-writer` reference
   "migrations paths", "infra paths", "docs paths" in their prompts, but those
   lists do not exist in the schema, so there is nothing to enforce against.

## Goals

- Enforce each editing agent's **allow-list** at the tool level on Claude Code:
  an `Edit`/`Write`/`MultiEdit`/`NotebookEdit` to a path outside the agent's
  allowed globs is **blocked**, not merely discouraged.
- Cover all six editing agents (extend the schema so migration/devops/doc agents
  have lists to enforce).
- Stay **backward compatible**: existing manifests keep working with no changes.
- Keep the human-readable `CLAUDE.md` in sync with what is actually enforced.

## Non-goals

- Enforcing scope on **Kiro / Codex** — they have no hook mechanism; they remain
  prompt-only. (Documented limitation, unchanged.)
- Guarding **`Bash`** writes. A builder has `Bash`, so `bash -c 'echo > src/x'`
  bypasses the Edit/Write hooks. Out of scope — same coverage boundary as the
  existing forbidden guard. Documented, not solved.
- Enforcing `shared`. Per the README, `shared` is *read-only context* ("readable
  by either builder"), not an editable set. It is never added to any allow-list.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Coverage | Extend schema + enforce all **6** editing agents |
| Absent-list policy | **Opt-in**: an agent with *no* list → prompt-only (no hook). An *empty* list `[]` → hook emitted → agent can edit nothing. |
| Mechanism | Per-agent frontmatter `hooks:` + one config-driven guard script |
| Platforms | Claude Code only |

## Agent → allow-list mapping

| Agent | Manifest key | Editable when key present |
|---|---|---|
| `backend-builder` | `paths.backend` | yes |
| `frontend-builder` | `paths.frontend` | yes |
| `test-verifier` | `paths.tests` | yes |
| `migration-author` | `paths.migrations` *(new)* | yes |
| `devops-builder` | `paths.infra` *(new)* | yes |
| `doc-writer` | `paths.docs` *(new)* | yes |
| researcher, story-writer, spec-writer, security-reviewer, performance-reviewer, validator | — | read-only; no edit tools, no hook |

## Design

### Two enforcement layers (both Claude Code only)

1. **Session-level forbidden net** — unchanged in behavior. A `PreToolUse` hook
   in `.claude/settings.json` runs for every tool call in every context
   (orchestrator session and all subagents) and blocks any edit matching the
   global `forbidden` globs.
2. **Per-agent allow-list** — new. Each editing agent whose list is present
   carries its own `PreToolUse` hook in its frontmatter. When that subagent
   edits, the hook enforces *that agent's* allow-list: the path must match at
   least one of its allow-globs, or the edit is blocked.

When a builder edits, both layers fire (forbidden net + its own allow-list).
That is intentional defense-in-depth; both must pass.

### Unified, config-driven guard

The existing `factory-guard.mjs` embeds the forbidden list inline. Replace it
with a config-driven guard so one script serves both layers.

- **`.claude/hooks/factory-scope.json`** — generated each install:
  ```json
  {
    "forbidden": [".env*", "**/secrets.*"],
    "agents": {
      "backend-builder": ["src/routes/**", "src/services/**"],
      "doc-writer": ["docs/**", "CHANGELOG.md"]
    }
  }
  ```
  `agents` contains **only** agents whose list is present in the manifest
  (opt-in). An agent with an empty list appears as `"agent": []`.

  **Emit condition:** the guard script + `factory-scope.json` are written when
  there is anything to enforce — `forbidden` non-empty **or** at least one agent
  allow-list present. If neither holds, nothing is written, and any
  previously-generated guard script, config, and session-level hook entry are
  removed. The session-level `settings.json` hook is added only when `forbidden`
  is non-empty (allow-lists are wired per-agent, not at session level).

- **`.claude/hooks/factory-guard.mjs [agentName]`** — the guard:
  1. Read the `PreToolUse` payload from stdin; extract the edited path
     (`tool_input.file_path` / `notebook_path` / `path`). No path → exit `0`.
  2. Compute the repo-relative path (strip `cwd`).
  3. **Forbidden check (always):** if the relative path *or* its basename
     matches any `forbidden` glob → block (exit `2`).
  4. **Allow-list check (only when `agentName` is passed and present in
     `agents`):** if the relative path matches **none** of that agent's
     allow-globs → block (exit `2`). Allow matching is **rel-anchored only**
     (no basename matching — basename matching is only meaningful for the
     filename-style forbidden patterns like `.env*`).
  5. Otherwise exit `0`.

  Blocking writes a clear reason to stderr (which Claude Code surfaces to the
  model) naming the offending path, the rule, and how to fix it (edit
  `.factory.yaml`).

### Wiring

- **Session level** (`settings.json`, merged as today): command
  `node "$CLAUDE_PROJECT_DIR/.claude/hooks/factory-guard.mjs"` (no agent arg →
  forbidden-only). Merge semantics unchanged: only the factory's hook entry is
  added/refreshed; other user settings and hooks are preserved. Toggling
  `forbidden` empty removes the entry (existing behavior).

- **Per-agent** (agent frontmatter): for each of the six editing agents whose
  list is present, emit a `hooks:` block in the generated
  `.claude/agents/<name>.md` frontmatter:
  ```yaml
  hooks:
    PreToolUse:
      - matcher: "Write|Edit|MultiEdit|NotebookEdit"
        hooks:
          - type: command
            command: node "$CLAUDE_PROJECT_DIR/.claude/hooks/factory-guard.mjs" backend-builder
  ```
  Agents with no list get no `hooks:` block (opt-in).

### Glob matching

Reuse the existing `globToRegExp` logic from the current guard (`**/` matches
zero+ leading dirs, `*` → `[^/]*`, `?` → `[^/]`, regex specials escaped,
anchored with `^…$`). `forbidden` tests `rel` and `basename`; `allow` tests
`rel` only.

## Changes by file

- `src/manifest.ts` — add `migrations? / infra? / docs?` to `Paths`.
- `src/render.ts` — `buildContextFile` renders Migration / DevOps / Doc allow
  blocks under "Path scoping for agents" (only when non-empty), mirroring the
  existing backend/frontend/tests blocks.
- `src/platforms/claude-code.ts`:
  - Replace `writeForbiddenGuard` with a `writeScopeGuard` that emits
    `factory-scope.json` + the config-driven `factory-guard.mjs`, and merges the
    session-level forbidden hook (when `forbidden` present), with the same
    opt-in/removal/idempotency behavior as today.
  - When generating each editing agent file, append the per-agent `hooks:`
    frontmatter block iff that agent's allow-list is present.
- `src/util/profile-defaults.ts` — parse the three new keys.
- `src/commands/init.ts` — `composeManifest` iterates the three new keys.
- `profiles/*.md` — add sensible `migrations / infra / docs` defaults under
  "Default paths" where they apply (e.g. node-fastify `migrations: prisma/**`,
  `docs: docs/**, CHANGELOG.md`; go-echo `migrations: migrations/**`; etc.).
- `README.md` — document the per-agent enforcement, the new path keys, the
  opt-in policy, and the `Bash`/other-platform limitations.

## Testing

- **Schema:** a manifest with `migrations/infra/docs` loads and normalizes.
- **Render:** CLAUDE.md shows the three new scoping blocks when present, omits
  them when absent.
- **Config generation:** `factory-scope.json` lists only agents whose list is
  present; empty list serialized as `[]`; forbidden carried through.
- **Per-agent frontmatter:** `backend-builder.md` has the `hooks:` block
  referencing `factory-guard.mjs backend-builder` when `backend` is present;
  an agent with no list has no `hooks:` block.
- **Guard behavior (execute the real script):**
  - forbidden path → exit `2` with/without an agent arg (global net).
  - `backend-builder` editing `src/**` → `0`; editing `docs/**` → `2`.
  - `doc-writer` editing `docs/**` → `0`; editing `src/**` → `2`.
  - agent not in config (opt-in/absent) → allow-list not enforced (only
    forbidden applies).
  - no path in payload → `0`.
- **Merge/idempotency:** session hook merge preserves other settings; re-install
  produces no duplicate hooks; toggling `forbidden` empty strips the session
  hook.

## Backward compatibility

Existing manifests have none of the new keys and no `hooks:` in their agents
until re-installed. After re-install: only agents whose lists already exist
(`backend/frontend/tests`) gain enforcement; `migration/infra/docs` stay
prompt-only until the user adds those keys. No manifest must change to keep
working. The `factory-scope.json` + config-driven guard supersede the inline
`factory-guard.mjs`; a re-install overwrites the old script in place.
