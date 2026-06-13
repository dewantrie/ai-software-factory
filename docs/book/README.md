# The ai-factory Book

A guide to **why** this system is built the way it is — not just how to use it (the
top-level [`README.md`](../../README.md) covers usage). Read this when you want to
understand the design, teach it to someone, or extend it without breaking the ideas
that make it work.

## Who this is for

- **New contributors** who need the mental model before touching code.
- **Operators** deciding how to roll the factory out across repos.
- **Future-you**, six months from now, asking "why did we do it this way?"

## How to read it

Read 00 → 03 in order; that's the spine. After that, jump to whatever you need.

| Ch | Title | What you learn |
|----|-------|----------------|
| [00](00-introduction.md) | The problem | What pain this exists to remove, and the one-sentence thesis |
| [01](01-concepts.md) | The four primitives | Prompts, profiles, manifest, adapters — and how they compose |
| [02](02-the-pipeline.md) | The install pipeline | What `factory install` actually does, step by step |
| [03](03-the-agent-chain.md) | The agent chain | 12 agents, 3 tiers, 3 checkpoints, and the human/AI split |
| [04](04-path-enforcement.md) | Path enforcement | Prompt-only vs enforced; the two-layer guard and **why** it's shaped that way |
| [05](05-adapters.md) | Platform adapters | The `PlatformAdapter` contract; why Claude Code is the reference |
| [06](06-profiles.md) | Profiles | Per-stack rule packs, least-privilege defaults, the "docs-only defaults" trap |
| [07](07-cross-repo.md) | Cross-repo features | The contracts bridge and the feature lifecycle |
| [08](08-extending.md) | Extending the factory | Add a profile, an adapter, an agent, a path key — recipes |
| [09](09-design-decisions.md) | Design decisions | ADR-style record of the hard choices, trade-offs, and known limits |

## The one-paragraph version

ai-factory turns **one source of truth** — platform-neutral agent prompts, per-stack
profiles, and a tiny per-repo manifest — into the **platform-specific files** each AI
coding tool expects (Claude Code, Kiro, Codex, …). It encodes a disciplined
human-in-the-loop chain (research → story → brief → build → review → docs) and, on
Claude Code, **enforces** which files each agent may edit at the tool level. The whole
point is to run the *same* high-quality process across many repos, many stacks, and
many AI platforms without copy-pasting prompts into each one.

## A note on accuracy

Every chapter points at real files (e.g. `src/render.ts`, `src/platforms/claude-code.ts`).
If the code and the book disagree, the code wins — fix the book. Treat drift as a bug.
