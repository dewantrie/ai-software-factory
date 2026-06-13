# 00 — The Problem

## The situation this was built for

You don't have one repo. You have many: a billing API in Node, a worker in Go, a
web app in Next.js, a shared component library, a mobile app. Different stacks,
different conventions, owned by overlapping people.

You also don't use one AI coding tool. Someone uses Claude Code, someone else uses
Cursor, the CI pipeline shells out to Codex, a teammate prefers Kiro.

And you want all of them to follow the **same disciplined process**: understand
before building, get human sign-off on the plan, write tests, run security and
performance review, keep docs current. The kind of process a good senior engineer
imposes by habit.

Without a system, you get **drift**:

- Each repo's `CLAUDE.md` / `AGENTS.md` is hand-written and slowly diverges.
- A good prompt improvement made in one repo never reaches the other twelve.
- "Backend agents must not edit migrations" is a rule someone remembers, sometimes.
- Onboarding a new repo means copy-pasting a pile of files and editing them by hand.

The cost isn't one big failure; it's a thousand small inconsistencies that erode
trust in the AI-assisted workflow until people stop using it.

## The thesis

> **Write the process once, in a neutral form. Generate the platform-specific files
> mechanically. Make the safety rules enforceable, not aspirational.**

Everything in this codebase follows from that sentence:

- **"Write the process once"** → prompts and profiles live in *this* repo, not in
  each project repo (Chapters [01](01-concepts.md), [06](06-profiles.md)).
- **"In a neutral form"** → prompts mention no stack and no platform; a template
  variable `{{CONTEXT_FILE}}` is the only seam (Chapter [01](01-concepts.md)).
- **"Generate … mechanically"** → a small CLI reads a per-repo manifest and renders
  the right files for each platform (Chapters [02](02-the-pipeline.md),
  [05](05-adapters.md)).
- **"Enforceable, not aspirational"** → on Claude Code, the files an agent may edit
  are guarded by a hook, not just described in prose (Chapter
  [04](04-path-enforcement.md)).

## What "good" looks like

A new repo is onboarded with a ~20-line `.factory.yaml` and one command:

```bash
factory init      # interactive: detects stack, writes .factory.yaml
factory install   # generates CLAUDE.md, .claude/agents/*, hooks, etc.
```

A prompt improvement is made **once** in `prompts/agents/validator.md`, then:

```bash
factory sync      # re-installs every repo in the workspace
```

…and twelve repos get the better validator. That propagation property — fix once,
apply everywhere — is the entire return on investment. Keep it sacred: anything that
pushes per-repo customization back into hand-edited generated files breaks it.

## What this is *not*

- It is **not** an agent runtime. It generates the files; the AI platforms (Claude
  Code, etc.) actually run the agents. ai-factory is a **compiler**, not an executor.
- It is **not** a sandbox. The path guard (Chapter [04](04-path-enforcement.md)) is a
  guardrail that blocks `Edit`/`Write`; it does not contain a determined `Bash`
  command. Know the boundary so you don't over-trust it.

Next: [01 — The four primitives](01-concepts.md).
