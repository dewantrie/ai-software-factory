# 09 — Design Decisions

A record of the choices that shaped the system, each as **decision → why →
trade-off/alternative**. When you're about to change one of these, read its entry first
so you don't relearn the reasoning the hard way.

This chapter absorbs the rationale that previously lived in standalone spec/plan files;
it's the single home for "why is it like this?"

---

### D1 — Separate prompts, profiles, manifest, adapters

**Decision:** Four primitives, each owning one axis of change (Chapter [01](01-concepts.md)).
**Why:** A change to *process*, *stack*, *repo facts*, or *platform output* should touch
exactly one place. That's what makes the system teachable and safe to extend.
**Trade-off:** More moving parts than a single template file; you must learn the four
roles before the codebase makes sense. Worth it the moment you have more than one repo.

### D2 — Platform-neutral prompts with a single `{{CONTEXT_FILE}}` seam

**Decision:** Prompts mention no stack and no platform; the only variable is the context
file name.
**Why:** A prompt written once must run in every repo on every platform. Any hard-coded
`pnpm` or "Claude Code" forks the prompt into per-repo copies and kills the "fix once,
apply everywhere" property.
**Trade-off:** Prompts can't lean on platform-specific affordances; platform behavior must
be expressed through the context file or the adapter instead.

### D3 — Three human checkpoints, placed by cost-of-mistake

**Decision:** Human approves story (1), brief (2), and diff (3); AI owns the work between.
**Why:** Wrong assumptions are cheapest to fix early (Chapter [03](03-the-agent-chain.md)).
A bad approach caught at the brief costs a re-prompt; caught after building, hours.
**Trade-off:** Three stops add latency to a feature. That latency is the premium you pay
to avoid expensive late rework — deliberately not optimized away.

### D4 — One job per agent, fresh context, scoped tools

**Decision:** 12 narrow agents instead of one big prompt.
**Why:** Focus produces better output; tool scoping makes "read-only" structural; you tune
one prompt when one thing misbehaves.
**Trade-off:** More invocations and explicit hand-offs (the orchestrator passes prior
outputs forward). Costs tokens; buys reliability.

### D5 — Per-agent frontmatter hooks for allow-lists (not a session-level inference)

**Decision:** Enforce per-agent allow-lists via a hook in each agent's *frontmatter*,
carrying the agent name as an argument; enforce the global `forbidden` list via a
*session-level* hook (Chapter [04](04-path-enforcement.md)).
**Why:** A session-level `PreToolUse` hook doesn't reliably know *which* subagent is
acting, so it can't pick the right per-agent rule. We know the agent at **generation
time**, so we bake its identity into its own hook command.
**Alternative rejected:** A single session hook that infers the acting agent — the
information isn't in the payload.
**Trade-off:** *Per-agent* scoping needs frontmatter hooks, so it is Claude-Code- and
Kiro-CLI-specific. Codex reaches the same end state by a different route (post-run
git-diff revert, D11); the Kiro IDE flow stays prompt-only.

### D6 — Opt-in enforcement (absent key = unenforced)

**Decision:** An agent with no manifest path key gets no hook; an empty list means "edit
nothing"; only declared keys are enforced.
**Why:** Backward compatibility. Deny-by-default would block agents in every existing repo
until all keys were added. Opt-in lets teams adopt enforcement key by key without a flag
day.
**Trade-off:** An un-upgraded manifest is under-enforced silently. Mitigated by
documentation (top-level README "Opt-in / upgrading existing repos") telling users to add
keys and re-install.

### D7 — Guard covers Edit/Write only; Bash is handled by other layers

**Decision:** The path guard intercepts `Write`/`Edit`/`MultiEdit`/`NotebookEdit`, not
`Bash`. Shell and subprocess writes are covered by two further layers instead
(Chapter [04](04-path-enforcement.md)): `permissions.deny` rules, and an opt-in OS-level
sandbox.
**Why:** Reliably guarding arbitrary shell *inside a hook* would mean parsing shell —
infeasible. But the platform already solves the same problem twice, better: permission
rules understand the file commands Claude Code recognises, and the sandbox is enforced by
the OS so it reaches child processes the agent spawns.
**Trade-off:** Only layers 1–2 are per-agent. A shell write is stopped by the forbidden
list, never by an allow-list, so **per-agent scoping remains a guardrail, not
containment**. Say that plainly rather than implying the sandbox scopes agents.

### D8 — Profile defaults are documentation, not config

**Decision:** A profile's `Default paths/commands` are parsed only by `factory init`, not
by `install`; the manifest is the source of truth (Chapter [06](06-profiles.md)).
**Why:** Keeps the manifest the single per-repo source of truth and the profile body
primarily human/AI-readable prose. Avoids two competing sources for the same values.
**Trade-off:** Surprising indirection — editing a profile's defaults does nothing to
existing repos until `init` re-runs or values are copied. A regex extracts the YAML, which
is mildly fragile to heading changes.

### D9 — Guard script as a static asset (resolved)

**History:** `factory-guard.mjs` was originally produced from a template literal inside
`claude-code.ts`. That was simplest to ship but the escaping was fragile (doubled
backslashes) and the script couldn't be unit-tested except by generating-then-executing —
it caused two real bugs (a brace-glob miss and a path-traversal hole).
**Decision (current):** the script is a real committed file, `assets/factory-guard.mjs`,
copied verbatim into each repo (`copyFileSync`, `GUARD_ASSET_PATH` resolved via
`import.meta.url`). It's unit-tested directly in `test/factory-guard.test.ts`.
**Trade-off:** one more file to ship; if the package is ever published to npm, `assets/`
must be included (it isn't excluded today). Net: the escaping fragility is gone and the
guard is testable in isolation.

### D10 — Anything that changes session behaviour is opt-in

**Decision:** `models:`, `hooks:` and `sandbox:` all default to off, and generated output
is byte-identical until a manifest asks for them.
**Why:** This tool's files land in many repos at once via `sync`. A default that silently
changes how every session behaves — a blocking `Stop` hook, a cheaper model on an agent,
a sandbox constraining every command — is a change nobody asked for, arriving through a
channel they can't easily audit. Opt-in keeps `sync` safe to run.
**Trade-off:** Fewer people get the benefit by default, and the README has to *recommend*
settings instead of shipping them. Accepted: a recommendation can be ignored, a bad
default cannot.
**Test:** the golden snapshot is unchanged by the commits that added all three — that is
the proof, not the claim.

### D11 — Codex keeps a post-run check even though it has PreToolUse

**Decision:** Do **not** replace the Codex git-diff scope guard with a `PreToolUse` hook,
despite Codex gaining hooks with the same event schema as Claude Code.
**Why:** Codex edits through `apply_patch`, whose `PreToolUse` payload carries
`tool_input.command` — the patch text — not a file path, and its docs state there is no
documented way for a hook to learn which paths a call will write. The shared guard reads
`tool_input.file_path`, which Codex never sends, so it would have matched nothing.
**What that would have cost:** a **silent no-op** — documentation claiming enforcement
over nothing enforced. That is strictly worse than an honest gap, because it removes the
reader's reason to look further.
**Trade-off:** Codex enforcement stays detect-and-revert rather than block-before. Fine:
because it diffs the tree, it catches Bash-written files that a pre-edit hook would miss.

### D12 — Golden snapshots of generated output

**Decision:** Snapshot the generated file tree (real prompts, paths only) and the composed
file contents (synthetic minimal prompts, full text) in `test/golden.test.ts`.
**Why:** Every other test asserted *behaviour* — "a hook block is present", "the count is
N". None asserted the bytes. Adapter output is copied verbatim into every consuming repo,
so a formatting or ordering change could land everywhere without appearing in any diff.
**Why split in two:** using real prompts for the content snapshot would drag ~1,900 lines
of prompt text across three platforms into the file, and every prompt edit would churn it.
Paths-only for the real set, synthetic bodies for the content — each catches what the
other can't.
**Earned its keep immediately:** it caught a single trailing space in `tools:`
frontmatter, and a refactor that silently reordered `{matcher, hooks}` to `{hooks,
matcher}` — no functional change, but a `settings.json` diff in every consuming repo.

---

## Known limitations (be honest)

| Area | Limitation |
|---|---|
| Platform parity | Enforced path scoping exists on Claude Code (pre-edit hook), **Codex** (post-run git-diff guard), and **Kiro CLI** (pre-edit `preToolUse` hook). Kiro **IDE** stays prompt-only. Automatic fix loops are Claude-Code-only, and so are the deny-rule / sandbox layers and the `Stop` / `SubagentStop` hooks — Kiro and Codex both have an equivalent seam now, but neither contract is documented precisely enough to generate against (D11). |
| Adapters | Three implemented: Claude Code, Kiro, Codex. Cursor/Windsurf are not shipped (rules-file tools with no enforcement seam → an adapter would be prompt-only). |
| Bash | The *hook* can't stop file writes done via `Bash` (D7). `permissions.deny` covers the shell file commands Claude Code recognises, and `sandbox: true` covers subprocesses — but both are session-wide, so a shell write is never checked against a **per-agent** allow-list. |
| Contracts bridge | Manual (not chain-integrated), no contract-format validation, no `status.yaml` locking (Chapter [07](07-cross-repo.md)). |
| Install backfill | `install` regenerates from the *manifest*, not the profile, so old manifests don't auto-gain new path keys (a consequence of D6/D8 — opt-in by design). |
| Profile defaults | The docs-only-defaults indirection (D8) surprises newcomers. |

## Future work (roughly by leverage)

1. ~~Move the guard script to a static asset + direct unit tests~~ — **done** (D9);
   `assets/factory-guard.mjs` + `test/factory-guard.test.ts`.
2. **Run it for real.** Everything from the lifecycle hooks onward is verified as
   *generated correctly*, not as *honoured by the platform* — those contracts came from
   official docs, not from execution. One real session with
   `stop-on-failing-validation` on would turn documentation into evidence, and is worth
   more than the next feature.
3. **Platform parity (blocked on docs, not effort).** Kiro's `.kiro/hooks/*.json` shape
   is documented but its exact trigger spelling, STDIN payload and exit-code contract
   are not, and the agent `permissions` page 404s. Codex hooks can't express path
   scoping (D11). Both are ready the moment the contracts are pinned down — the same
   silent-no-op risk applies until then.
4. ~~Finish or remove the Cursor/Windsurf stubs~~ — **done**: removed (they were
   throwing stubs with no enforcement seam). Re-add via Recipe B if a prompt-only adapter
   is wanted.
5. **Chain ↔ contracts integration** — auto-pull on chain start, auto-ship on completion.
6. **Contract-format validation** — verify the backend's emitted contract matches what the
   frontend expects.

## How to keep this book true

If you change behavior, update the chapter that describes it in the same PR. Treat
book/code drift as a bug (the [index](README.md) says so). The fastest way to mislead a
future contributor is a confident, wrong document — worse than no document at all.
