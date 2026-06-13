# 05 — Platform Adapters

An adapter is the only part of the system that knows about a specific AI tool. Keep all
platform-specific knowledge *here* and nowhere else — that's what keeps prompts and
profiles neutral (Chapter [01](01-concepts.md)).

## The contract

Every adapter implements `PlatformAdapter` (`src/platforms/index.ts`) and is registered
in the `registry` there. `getAdapter(name)` resolves one; `allPlatforms` lists them.

```ts
export interface PlatformAdapter {
  name: Platform;
  contextFileName: string;            // the platform's CLAUDE.md-equivalent
  generate(args: {
    targetRoot, manifest, agents, skills, profileBody
  }): Promise<PlatformWriteResult>;   // { filesWritten, filesSkipped }
}
```

The inputs are identical for every platform — the same manifest, the same prompt bodies,
the same profile text. The adapter's whole job is to **shape** that shared input into the
files its platform expects. Two adapters given the same inputs produce different file
trees; that difference *is* the adapter.

## The platforms today

| Platform | State | Emits |
|---|---|---|
| `claude-code` | reference | `CLAUDE.md`, `.claude/agents/*`, `.claude/skills/*/SKILL.md`, path-guard hook |
| `kiro` | real | `.kiro/steering/*` (always/manual inclusion), `.kiro/FACTORY.md` |
| `codex` | real | `AGENTS.md`, `.codex/agents/*`, `.codex/orchestrator/*.sh`, `.codex/FACTORY.md` |
| `cursor` | stub | throws; target layout documented in `src/platforms/cursor.ts` |
| `windsurf` | stub | throws; target layout documented in `src/platforms/windsurf.ts` |

### claude-code — the reference

The richest adapter (Chapter [02](02-the-pipeline.md)). It's the reference because Claude
Code has the features the factory's model assumes: native subagents (so each agent runs
isolated with its own tools), and `PreToolUse` hooks (so path scoping can be **enforced**,
Chapter [04](04-path-enforcement.md)). Everything else is measured against it.

### kiro

Kiro has no subagent system, so the chain runs **semi-manually**: each agent becomes a
manual-inclusion steering file you invoke with `#agent-<name>` in chat, and the skill
file is the script the human (or Kiro's agentic chat) follows. `project.md` is an
always-included steering file holding the context. No tool scoping, no hooks — those
features don't exist on the platform.

### codex

Codex auto-loads `AGENTS.md`. The chain is implemented as **bash orchestrators**
(`.codex/orchestrator/*.sh`) that chain `codex exec` calls, capture each step's output
under `.codex/runs/<timestamp>/`, and pause for human approval with `read -p`. Because
each `codex exec` is a fresh process with no shared memory, the orchestrator concatenates
prior outputs into each prompt explicitly — the same "information passing" idea as the
Claude chain, done in shell.

### cursor / windsurf — stubs

These intentionally `throw` with a clear message and document their target layout in
comments. They exist so the *shape* of the work is known when someone needs them; filling
them in is a contained task (Chapter [08](08-extending.md)).

## Why platforms are not equal — and why that's OK

The same `.factory.yaml` produces materially different rigor per platform:

- **Claude Code:** native subagents + enforced path scoping (pre-edit `PreToolUse` block)
  + (in the chain) automatic fix loops.
- **Codex:** enforced path scoping too, but via a different mechanism — the orchestrator
  scripts run a post-run git-diff guard (`factory-check.mjs`) that reverts + halts on
  out-of-scope edits (Chapter [04](04-path-enforcement.md)). No automatic fix loops; human
  drives more of the sequence.
- **Kiro:** prompt-only scoping (no hook/shell mechanism), no fix loops.

This asymmetry is honest, not accidental: an adapter can only use the features its
platform actually has. The factory's job is to emit the **best** files each platform can
use, not to pretend they're equivalent. The `FACTORY.md` each adapter writes spells out
that platform's limitations so users aren't misled.

When you read marketing-style claims ("works on 5 platforms"), translate them through
this chapter: two are stubs, and the three live ones differ in how much they enforce.
Chapter [09](09-design-decisions.md) lists closing that gap as known future work.

## The rule that keeps this clean

> Platform knowledge lives **only** in adapters.

If you find yourself wanting to add a platform conditional inside `render.ts`, a prompt,
or a profile — stop. That's a signal the abstraction is leaking. Push the difference into
the adapter (or, rarely, add a neutral hook to `RenderContext`). The neutrality of the
other three primitives is worth protecting; adapters are where platform messiness is
*supposed* to live.

Next: [06 — Profiles](06-profiles.md).
