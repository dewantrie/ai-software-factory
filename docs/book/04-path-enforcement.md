# 04 — Path Enforcement

This is the chapter that turns a promise into a guarantee. The factory's headline claim
is *"a builder cannot touch files outside its list."* This chapter explains how that's
enforced on Claude Code, and — more usefully — **why it's built exactly this way**, so
you can extend it without reintroducing the hole it closes.

## The problem: frontmatter scopes tools, not paths

A Claude Code subagent's frontmatter can restrict **which tools** it has
(`tools: Read, Grep, Glob`). It cannot restrict **which paths** an allowed tool may
touch. So a `backend-builder` with `Edit`/`Write` can, as far as the platform cares,
edit `frontend/`, `prisma/`, or `.env`.

For a long time the only defense was prose in `CLAUDE.md` ("Backend Builder may edit:
`src/**`") and the agent's good behavior. That's aspirational, not enforced. The whole
point of this subsystem is to make it real.

## The mechanism: a PreToolUse hook

Claude Code lets you register a **`PreToolUse` hook** — a command that runs *before* a
tool call, receives the call's JSON on stdin, and can **block** it by exiting non-zero
(exit `2`). That's the lever. The guard is a small Node script wired in as a
`PreToolUse` hook that inspects the target path and blocks edits outside scope.

## The hard part: *which agent* is editing?

Here's the design crux. There are two kinds of rule:

- **`forbidden`** is *global* — no agent, ever, may touch `.env`/secrets. Same rule
  regardless of who's acting.
- **allow-lists** are *per-agent* — `backend-builder` may edit `backend`, `doc-writer`
  may edit `docs`. The rule depends on **who** is editing.

A single hook in `.claude/settings.json` runs for *every* tool call in *every* context,
but the payload does **not** reliably tell you which subagent is currently running. So a
session-level hook can enforce the global `forbidden` rule, but it **cannot** enforce
per-agent allow-lists — it doesn't know whose rule to apply.

That single fact dictates the entire architecture below. We considered a session-level
hook that infers the acting agent and rejected it: the information isn't there. We chose
instead to put the agent identity where we *do* know it — at generation time, in each
agent's own frontmatter.

## The two-layer design

```
Layer 1 — global forbidden net (session level)
  .claude/settings.json  PreToolUse → factory-guard.mjs          (no agent arg)
  Applies to every agent and the orchestrator. Blocks `forbidden` globs.

Layer 2 — per-agent allow-lists (agent level)
  .claude/agents/backend-builder.md frontmatter:
    hooks: PreToolUse → factory-guard.mjs backend-builder        (agent arg!)
  Runs only when THAT subagent edits. Blocks paths outside its allow-list.
```

When a builder edits, **both** layers fire (forbidden net + its own allow-list). That's
intentional defense-in-depth; both must pass.

The agent name is baked into the frontmatter command at generation time
(`factory-guard.mjs backend-builder`). That's how we solve "which agent?" — we don't
infer it at runtime, we **know it at build time** and pass it as an argument.

## One script, one config

Rather than embed rules in each hook, the adapter emits:

- **`.claude/hooks/factory-scope.json`** — the data:
  ```json
  {
    "forbidden": [".env*", "**/secrets.*"],
    "agents": { "backend-builder": ["src/**"], "doc-writer": ["docs/**"] }
  }
  ```
- **`.claude/hooks/factory-guard.mjs`** — the logic. Reads the config beside it, takes
  an optional `agentName` argument, reads the tool payload from stdin, and:
  1. always blocks if the path matches a `forbidden` glob (rel-path **or** basename);
  2. if `agentName` has an allow-list, blocks if the rel path matches **none** of it
     (rel-anchored only — basename matching is wrong for allow-lists);
  3. otherwise exits `0`.

The `agents` map contains **only** agents whose list is present in the manifest. The
agent name → manifest key mapping lives in `ALLOW_KEY_BY_AGENT` in
`src/platforms/claude-code.ts`:

| Agent | Manifest key |
|---|---|
| backend-builder | `backend` |
| frontend-builder | `frontend` |
| test-verifier | `tests` |
| migration-author | `migrations` |
| devops-builder | `infra` |
| doc-writer | `docs` |

`shared` is deliberately **not** an allow-list — it is read-only context ("readable by
either builder"), never an editable set.

## Why opt-in (absent = unenforced)

This is a deliberate policy, chosen for **backward compatibility**:

- A manifest key that is **absent** → that agent gets **no hook** → it behaves exactly
  as before (prompt-only). Existing manifests keep working untouched.
- A key present but **empty** (`[]`) → hook emitted → that agent can edit **nothing**.
- A key present with globs → enforced to those globs.

The alternative — deny-by-default — would block agents in every existing repo until all
six keys were added. We chose to let teams **opt in** key by key. The cost: an old repo
gains enforcement only for the keys it already declares; to enforce
`migrations`/`infra`/`docs` you add those keys and re-install. That's documented in the
top-level README so it isn't a surprise.

## The glob engine, and a bug worth remembering

`globToRegExp` (inside the generated script) supports `**` (any depth), `*` (within a
segment), `?`, and **brace alternation** `{a,b}` → `(a|b)`. That last one exists because
of a real bug caught in review: two frontend profiles use `*.test.{ts,tsx}` as their
`tests` allow-list. Without brace support, that pattern matched **nothing**, which would
have locked `test-verifier` out of *all* edits the moment `tests` became enforced. The
lesson: when you promote a glob from "documentation" to "enforced", the glob engine must
actually be able to express the globs people already write.

## The boundary: what the guard does *not* do

Be precise about this so nobody over-trusts it:

- **It guards `Write`/`Edit`/`MultiEdit`/`NotebookEdit` only.** A builder also has
  `Bash`. `bash -c 'echo > src/x'` bypasses the hook. The guard is a **guardrail**, not
  a sandbox. (Guarding arbitrary Bash would mean parsing shell — out of scope.)
- **It's Claude Code only.** Kiro and Codex have no hook mechanism, so on those
  platforms scoping stays prompt-only. This is a platform limitation, not a choice.

Knowing the boundary is part of using it correctly. The guard stops the *common,
accidental* out-of-scope edit (the model reaching for the wrong file), which is the
failure mode that actually happens. It does not stop a determined adversary.

## Lifecycle (idempotency & cleanup)

`writeScopeGuard` is careful so repeated installs stay clean:

- Emits the script + config when there's anything to enforce (forbidden non-empty **or**
  any agent list present).
- Removes stale script/config/settings entries when there's nothing to enforce.
- Merges the session hook into `settings.json` without duplicating (`isOurHook` filter)
  and without clobbering the user's other settings/hooks.

All of this is covered by `test/guard.test.ts`, which **executes the real generated
script** against sample payloads rather than trusting its source — the right way to test
generated code.

Next: [05 — Platform adapters](05-adapters.md).
