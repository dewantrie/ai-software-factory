# ai-factory

Central factory for the 7-agent software factory pattern. Generates platform-specific files (Claude Code, Kiro, Cursor, Codex CLI, Windsurf) for many polyrepos from a single source of truth.

Designed for the case: **many repos, many techs, many AI platforms.**

## What it is

- **Prompts library** — 7 agent + 3 skill prompts written once, platform-neutral and stack-neutral.
- **Profile library** — pre-written rule packs per stack (Next.js, Node+Fastify, Go+Echo, Python+FastAPI, etc.).
- **Platform adapters** — code that renders prompts + profile + per-repo manifest into the right files for each AI platform.
- **CLI** — `factory install` reads `.factory.yaml` in any repo and generates everything.

## Architecture: AI and human collaboration

The chain is structured so the human stays in the loop where judgment matters, and steps out where the AI is reliable. Three layers, two roles, three checkpoints.

### Layers

| Layer | Owner | What it does |
|-------|-------|--------------|
| Orchestrator (skill) | AI, driven by human input | Chain logic. Decides which agent to invoke next. Pauses for human checkpoints. Routes failures back to the right builder. Does NOT edit files. |
| Specialist agents (7) | AI, with restricted tools | Each does one job in its own fresh context window. Tool scoping prevents agents from doing each other's work. |
| Reviewer | Human | Approves story, approves brief, reviews diff before merge. Tunes the rules over time. |

### The Tier 3 flow (full chain)

```
  HUMAN                                  ORCHESTRATOR (AI)              SPECIALIST AGENTS (AI)
  ─────                                  ─────────────────              ──────────────────────
  "build invoice reminders"  ─────────►  triage gate
                                              │
                                              ▼                    ┌──► researcher (read-only)
                                          invoke researcher  ──────┘
                                              ◄──── relevant files, patterns, risks
                                              │
                                              ▼                    ┌──► story-writer (read-only)
                                          invoke story-writer ─────┘
                                              ◄──── user story + acceptance criteria
                                              │
  CHECKPOINT 1                ◄─────────  presents story
  read & approve              ─────────►  continue
                                              │
                                              ▼                    ┌──► spec-writer (read-only)
                                          invoke spec-writer  ─────┘
                                              ◄──── technical brief (files-that-will-change, API, tests)
                                              │
  CHECKPOINT 2                ◄─────────  presents brief
  read & approve              ─────────►  continue
                                              │
                                              ▼                    ┌──► backend-builder (scoped edit)
                                          invoke backend-builder ──┤    writes files,
                                              ◄──── files + API contract + test results        runs typecheck/lint/test
                                              │
                                              ▼                    ┌──► frontend-builder (scoped edit)
                                          invoke frontend-builder ─┤    consumes contract verbatim,
                                              ◄──── files + test results                       writes files
                                              │
                                              ▼                    ┌──► test-verifier (test files only)
                                          invoke test-verifier  ───┘    writes 1 acceptance test
                                              ◄──── pass/fail per criterion                    per AC, runs them
                                              │
                                              ▼ fix loop if any AC fails (max 3 iterations)
                                              │
                                              ▼                    ┌──► validator (read-only)
                                          invoke validator    ─────┘
                                              ◄──── findings grouped Critical / Important / Minor
                                              │
                                              ▼ fix loop on Critical findings (max 3 iterations)
                                              │
                                              ▼
  CHECKPOINT 3                ◄─────────  final summary + PR title + body
  review diff, open PR        ─────────►  done
```

### Who decides what

| Decision | Owner | Notes |
|----------|-------|-------|
| Is this worth building? | Human | Trigger the chain. |
| Is the story right? | Human (AI drafts) | Block at CHECKPOINT 1 if not. |
| Is the technical approach sound? | Human (AI drafts) | Block at CHECKPOINT 2 if not. The brief catches architectural mistakes cheaply. |
| Which files to change? | AI (spec-writer) | Bounded by the brief — builders cannot touch files outside this list. |
| What code to write? | AI (builders) | Bounded by the spec + path scoping rules in the per-repo context file. |
| Did the implementation satisfy the story? | AI (test-verifier + validator) | Reported to human; auto-fix loops up to 3 iterations. |
| Is the diff merge-ready? | Human | Block at CHECKPOINT 3 if not. |
| What rules to add when an agent surprises you? | Human | Edit the profile or per-repo context file. This is how the chain improves over time. |

### Why this split

- **Humans are better at:** business judgment, ambiguous trade-offs, catching missing requirements, taste.
- **AI agents are better at:** breadth (reading many files quickly), discipline (checking the same 30 things every time), patience (writing the boring fixtures and edge-case tests).
- **The chain is bad at:** anything not covered by the validator's checklist. That's why the validator's checklist is the most important prompt to keep tuning — every gap the validator misses becomes a new line in its checklist.

The three checkpoints are not bureaucracy. They are where wrong assumptions cost the least to fix. A mistake caught at CHECKPOINT 2 (brief approval) costs a re-prompt. The same mistake caught after the builders run costs hours of rework.

## Repo layout

```
ai-factory/
├── prompts/
│   ├── agents/         ← researcher, story-writer, ... (platform-neutral)
│   └── skills/         ← feature-factory, quick-fix, spike
├── profiles/           ← stack rule packs (nextjs, node-fastify, go-echo, ...)
├── src/
│   ├── cli.ts          ← CLI entrypoint
│   ├── manifest.ts     ← .factory.yaml parsing + validation
│   ├── render.ts       ← prompt/profile composition
│   ├── commands/       ← install (init/sync still stubs)
│   └── platforms/      ← adapters: one per AI platform
└── examples/           ← sample .factory.yaml manifests
```

> Path examples in this README assume the checkout directory is named `ai-factory`. Adjust paths if you cloned it under a different name (e.g., `ai-software-factory`).

Each project repo gets a small `.factory.yaml` manifest (~20 lines) declaring layer, stack profile, commands, paths, and target platforms. `factory install` generates the platform files.

## Install

```bash
cd ai-factory
npm install
```

## Usage

In each project repo, create `.factory.yaml` (copy from `examples/` and edit):

```yaml
name: billing-api                          # repo identifier (required)
layer: backend                             # backend | frontend | worker | mobile | fullstack (required)
profile: node-fastify                      # file in profiles/ without .md (required)
factory-repo: ../ai-factory                # path to this checkout (optional, informational)
contracts-repo: ../ai-factory-contracts    # cross-repo contract dir (optional, Phase B)

commands:                                  # required — agents read these
  typecheck: pnpm typecheck
  lint: pnpm lint
  test: pnpm test
  acceptance: pnpm test:integration        # optional — separate acceptance/e2e command

paths:                                     # path scoping for agents (all lists optional)
  backend:                                 # Backend Builder may edit
    - src/routes/**
    - src/services/**
  frontend: []                             # Frontend Builder may edit
  shared:                                  # readable by either builder
    - packages/shared/**
  tests:                                   # Test Verifier may edit
    - tests/integration/**
  forbidden:                               # no agent may edit
    - .env*
    - "**/secrets.*"

dont-do:                                   # optional — appended to CLAUDE.md
  - Do not call the legacy /v1 endpoints.

platforms:                                 # required — which adapters to run
  - claude-code
  # - kiro      (stub)
  # - cursor    (stub)
  # - codex     (stub)
  # - windsurf  (stub)

notes: |                                   # optional — free-form prose appended to CLAUDE.md
  This repo is the authoritative source for billing API contracts.
```

Then run from your project repo:

```bash
npx tsx /path/to/ai-factory/src/cli.ts install
```

This reads your manifest, loads the matching profile, and writes platform-specific files (e.g., `.claude/agents/*.md` + `CLAUDE.md` for Claude Code).

> A global `factory` binary is planned — `package.json` declares `bin: ./bin/factory.mjs`, but that file isn't built yet. Use the `npx tsx` form above until the bin script lands.

## Status — Phase A

### Built
- ✅ Core CLI (`install` command)
- ✅ Manifest parsing + validation
- ✅ Render engine (template substitution + context-file generation)
- ✅ Platform-neutral agent prompts (7 agents, 3 skills)
- ✅ Stack profiles (Next.js App Router, Node+Fastify, Go+Echo, Python+FastAPI)
- ✅ **Claude Code adapter** — fully working
- ⏳ Kiro adapter — stub
- ⏳ Cursor adapter — stub
- ⏳ Codex CLI adapter — stub
- ⏳ Windsurf adapter — stub
- ⏳ `init` command (interactive manifest wizard) — placeholder
- ⏳ `sync` command (workspace-wide refresh) — placeholder
- ⏳ Cross-repo contract bridge (`ai-factory-contracts` repo + `feature start` / `feature ship` commands) — not started

### Roadmap (Phase B)
1. Wire up the 4 stub platform adapters.
2. Build the `init` wizard.
3. Build the `sync` command driven by a workspace file.
4. Build the contracts repo skeleton and `feature` subcommands.
5. Add more stack profiles (Rust+Axum, Bun+Hono, SvelteKit, Nuxt, React Native, .NET, Java/Spring).

## How prompts work

Each prompt in `prompts/agents/` and `prompts/skills/` is platform-neutral. References to the project context document use the template variable `{{CONTEXT_FILE}}`, which the adapter substitutes at install time (e.g., `CLAUDE.md`, `AGENTS.md`, `.kiro/steering/project.md`).

Stack-specific content (commands, paths, conventions) does NOT live in the prompts. It comes from:

- **Manifest** (per-repo) — commands, paths, layer, repo-specific don't-do rules.
- **Profile** (shared) — architecture rules, conventions, don't-do, default paths/commands.

The render engine in `src/render.ts` composes manifest + profile into the platform's context file. The adapter writes that file plus the agent/skill files in the platform's format.

## How profiles work

A profile is a markdown file under `profiles/`. It contains:
- Architecture rules
- Don't-do list
- Conventions
- Default paths (documentation only — see note below)
- Default commands (documentation only — see note below)

The profile body is **inlined verbatim** into CLAUDE.md (or the platform's context file) under the `## Profile rules` section, including its own markdown headings. When you write a profile, structure it as a self-contained section because its `## Architecture rules` heading ends up nested inside CLAUDE.md's `## Profile rules`.

The "Default paths" and "Default commands" YAML blocks in the profile are **reference documentation only** — they are not parsed. The real values come from the manifest's `paths:` and `commands:` blocks. Treat them as the suggested starting point a manifest author should copy.

To add a profile for a new stack:
1. Create `profiles/<your-stack>.md`.
2. Follow the structure of `profiles/nextjs-app-router.md` as a template.
3. Reference it in a manifest with `profile: <your-stack>`.

## How adapters work

Each adapter implements `PlatformAdapter` in `src/platforms/index.ts`:

```ts
export interface PlatformAdapter {
  name: Platform;
  contextFileName: string;
  generate(args: {
    targetRoot: string;
    manifest: Manifest;
    agents: PromptFile[];
    skills: PromptFile[];
    profileBody: string;
  }): Promise<PlatformWriteResult>;
}
```

`src/platforms/claude-code.ts` is the reference implementation. The stubs in `kiro.ts`, `cursor.ts`, `codex.ts`, `windsurf.ts` document the target layout for each platform — fill them in to enable.

## Cross-repo coordination (planned)

For features that touch multiple repos:

1. Backend repo runs `factory feature start <name>` — creates a feature folder in `ai-factory-contracts/features/<name>/` with `story.md`.
2. After the backend chain completes, the API contract is written to `ai-factory-contracts/features/<name>/api.openapi.yaml`.
3. Frontend repo reads the story + contract from there and runs its own chain.
4. Each repo's chain skips the agents that don't apply to its layer.

This is not built yet — Phase B.
