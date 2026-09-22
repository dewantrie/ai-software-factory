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

## The layered design

The hook is the part that knows about *agents*. Two further layers, both opt-in, widen
what the rules cover — because a hook on the edit tools cannot see a shell command, and
nothing inside Claude Code can see a subprocess.

```
Layer 1 — global forbidden net (session level)          [whenever any scope is declared]
  .claude/settings.json  PreToolUse → factory-guard.mjs          (no agent arg)
  Applies to every agent and the orchestrator. Blocks `forbidden` globs.

Layer 2 — per-agent allow-lists (same hook, agent from the payload)
  .claude/settings.json  PreToolUse → factory-guard.mjs
  The payload carries `agent_type`: the acting subagent's name, or null when
  the main session edits. The guard reads it and applies that agent's list.

Layer 3 — declarative deny rules                        [always, when forbidden is set]
  .claude/settings.json  permissions.deny: ["Edit(.env*)", …]
  Also covers the file commands Claude Code recognises inside Bash —
  `tee`, `sed`, and `> file` redirects — which layers 1–2 never see.

Layer 4 — OS-level sandbox                              [opt-in: `sandbox: true`]
  .claude/settings.json  sandbox.filesystem.denyWrite: ["./.env*", …]
  Enforced by the OS (Seatbelt / bubblewrap), so it covers a command's
  *child processes* — the Python script that opens the file itself.
```

When a builder edits, layers 1 and 2 **both** fire (forbidden net + its own allow-list).
That's intentional defense-in-depth; both must pass. Layers 3 and 4 are about *reach*
rather than agent identity: permission rules and the sandbox are session-wide, so they
can express "nobody writes this" but not "this agent may only write here".

Two syntax traps worth knowing, because both fail silently:

- **`Edit(...)`, never `Write(...)`.** Claude Code consults file-path rules for `Read`
  and `Edit` only; a path rule on `Write`/`NotebookEdit`/`MultiEdit` is accepted, never
  checked, and warns at startup.
- **The sandbox uses the opposite path convention.** Permission rules use `//path` for
  absolute and `/path` for settings-relative; sandbox paths use `/path` for absolute and
  `./path` for project-relative. `denyRule()` and `sandboxDenyWrite()` are separate
  functions in `claude-code.ts` for exactly this reason — sharing them would invite a
  silent inversion.

Layer 4 works at all only because of one documented property: **a `denyWrite` holds
inside the wider allow that makes the repo writable.** Without it the sandbox would only
have stopped writes *outside* the repo, which is not where `forbidden:` files live.

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

- **The Claude hook guards `Write`/`Edit`/`MultiEdit`/`NotebookEdit` only.** A builder
  also has `Bash`, and `bash -c 'echo > src/x'` bypasses the *hook*. (Guarding arbitrary
  Bash via a PreToolUse hook would mean parsing shell — out of scope.) Layer 3 covers
  the shell commands Claude Code itself recognises, and layer 4 covers everything
  including subprocesses — but **only layers 1–2 are per-agent**. A shell write is
  stopped by the forbidden list, never by an allow-list, so per-agent scoping remains a
  guardrail rather than containment.
- **Symlinks were a real hole, now closed.** `resolve()` is purely lexical, so a symlink
  inside an allowed directory (`src/services/leak.ts → ../../.env`) used to be matched by
  its link path and sail past the forbidden list. The guard now `realpath`s both the
  target and the cwd before matching, falling back to the deepest existing ancestor
  because the target of a `Write` usually doesn't exist yet. Regression-tested.
- **Per-platform mechanism differs.** Claude Code blocks *before* the edit (PreToolUse
  hook). **Kiro CLI** does the same — each agent's `.kiro/agents/*.json` carries a
  `preToolUse` hook on the `fs_write` tool that runs the *same* `factory-guard.mjs` and
  exits 2 to block (verified against `kiro-cli`). **Codex** enforces the same allow-lists
  *after* each `codex exec`, via a git-diff guard in the orchestrator (`factory-check.mjs`)
  that reverts + halts — and because it diffs the tree, it *does* catch `Bash`-written
  files (slightly stronger on that axis). **Kiro IDE** stays prompt-only (its hook/block
  contract isn't documented and `toolsSettings.allowedPaths` is reportedly unenforced).

The shared `assets/factory-scope.json` config and glob engine back both the Claude guard
and the Codex check, so the rules can't drift between platforms.

Knowing the boundary is part of using it correctly. The guard stops the *common,
accidental* out-of-scope edit (the model reaching for the wrong file), which is the
failure mode that actually happens. It does not stop a determined adversary.

## Lifecycle (idempotency & cleanup)

`writeScopeGuard` is careful so repeated installs stay clean:

- Emits the script + config when there's anything to enforce (forbidden non-empty **or**
  any agent list present).
- Removes stale script/config/settings entries when there's nothing to enforce.
- Merges into `settings.json` without duplicating and without clobbering the user's own
  settings. Every hook entry we write is owned by the **script name in its command**
  (`applyHook` / `ownsMarker`), so a user's own hook on the same event survives and ours
  never doubles up.
- Prunes its own `permissions.deny` and `sandbox.filesystem.denyWrite` rules by reading
  the **previous** `factory-scope.json` before overwriting it. That file is the only
  record of which rules this tool owns, so a shrunk or renamed `forbidden:` list cleans
  up after itself while the user's own rules are never touched.

### Why Codex keeps a post-run check

Codex has gained lifecycle hooks with the same event schema as Claude Code, which makes
"just reuse the shared pre-edit guard" look like an easy parity win. It isn't, and the
reason is worth recording so nobody re-proposes it.

Codex edits through `apply_patch`, and its `PreToolUse` payload carries
`tool_input.command` — a string holding the patch — not a file path. Its docs state
outright that there is no documented way for a hook to learn which paths a call will
write. The shared guard reads `tool_input.file_path`, which Codex never sends, so wiring
it up would produce a **silent no-op**: documentation claiming enforcement over nothing
enforced, which is worse than an honest gap. Observing the git tree *after* the fact is
the mechanism that actually fits that platform.

All of this is covered by `test/guard.test.ts`, which **executes the real generated
script** against sample payloads rather than trusting its source — the right way to test
generated code.

Next: [05 — Platform adapters](05-adapters.md).
