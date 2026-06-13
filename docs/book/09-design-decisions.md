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
**Trade-off:** The guard is Claude-Code-specific (needs frontmatter hooks + `PreToolUse`).
Other platforms stay prompt-only.

### D6 — Opt-in enforcement (absent key = unenforced)

**Decision:** An agent with no manifest path key gets no hook; an empty list means "edit
nothing"; only declared keys are enforced.
**Why:** Backward compatibility. Deny-by-default would block agents in every existing repo
until all keys were added. Opt-in lets teams adopt enforcement key by key without a flag
day.
**Trade-off:** An un-upgraded manifest is under-enforced silently. Mitigated by
documentation (top-level README "Opt-in / upgrading existing repos") telling users to add
keys and re-install.

### D7 — Guard covers Edit/Write only; Bash is out of scope

**Decision:** The path guard intercepts `Write`/`Edit`/`MultiEdit`/`NotebookEdit`, not
`Bash`.
**Why:** Reliably guarding arbitrary shell would mean parsing shell — infeasible. The
guard targets the *common, accidental* out-of-scope edit (the model reaching for the wrong
file), which is the failure that actually happens.
**Trade-off:** It's a guardrail, not a sandbox. A determined `bash -c 'echo > file'`
bypasses it. Don't market it as containment.

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

---

## Known limitations (be honest)

| Area | Limitation |
|---|---|
| Platform parity | Enforced scoping + automatic fix loops exist on Claude Code only. Kiro/Codex are prompt-only with no fix loops. |
| Adapters | Cursor and Windsurf are stubs that throw. "5 platforms" = 3 real + 2 documented stubs. |
| Bash | The guard can't stop file writes done via `Bash` (D7). |
| Contracts bridge | Manual (not chain-integrated), no contract-format validation, no `status.yaml` locking (Chapter [07](07-cross-repo.md)). |
| Install backfill | `install` regenerates from the *manifest*, not the profile, so old manifests don't auto-gain new path keys (a consequence of D6/D8 — opt-in by design). |
| Profile defaults | The docs-only-defaults indirection (D8) surprises newcomers. |

## Future work (roughly by leverage)

1. ~~Move the guard script to a static asset + direct unit tests~~ — **done** (D9);
   `assets/factory-guard.mjs` + `test/factory-guard.test.ts`.
2. **Close platform parity** — bring enforced scoping and/or fix loops to Codex (it has
   shell; a pre-`codex exec` path check is feasible), or clearly tier the platforms by
   capability so expectations match reality.
3. **Finish or remove the Cursor/Windsurf stubs** so the platform list stops over-claiming.
4. **Chain ↔ contracts integration** — auto-pull on chain start, auto-ship on completion.
5. **Contract-format validation** — verify the backend's emitted contract matches what the
   frontend expects.

## How to keep this book true

If you change behavior, update the chapter that describes it in the same PR. Treat
book/code drift as a bug (the [index](README.md) says so). The fastest way to mislead a
future contributor is a confident, wrong document — worse than no document at all.
