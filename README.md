# ai-factory

Central factory for the 7-agent software factory pattern. Generates platform-specific files (Claude Code, Kiro, Cursor, Codex CLI, Windsurf) for many polyrepos from a single source of truth.

Designed for the case: **many repos, many techs, many AI platforms.**

## What it is

- **Prompts library** — 7 agent + 3 skill prompts written once, platform-neutral and stack-neutral.
- **Profile library** — pre-written rule packs per stack (Next.js, Node+Fastify, Go+Echo, Python+FastAPI, etc.).
- **Platform adapters** — code that renders prompts + profile + per-repo manifest into the right files for each AI platform.
- **CLI** — `factory install` reads `.factory.yaml` in any repo and generates everything.

## Architecture

```
ai-factory/
├── prompts/
│   ├── agents/         ← researcher, story-writer, ... (platform-neutral)
│   └── skills/         ← feature-factory, quick-fix, spike
├── profiles/           ← stack rule packs (nextjs, node-fastify, go-echo, ...)
├── platforms/          ← adapters: one per AI platform
├── src/                ← TypeScript CLI source
├── examples/           ← sample .factory.yaml manifests
└── bin/factory         ← CLI entrypoint
```

Each project repo gets a small `.factory.yaml` manifest (~20 lines) declaring layer, stack profile, commands, paths, and target platforms. `factory install` generates the platform files.

## Install

```bash
cd ai-factory
npm install
```

## Usage

In each project repo, create `.factory.yaml` (copy from `examples/` and edit):

```yaml
name: billing-api
layer: backend
profile: node-fastify
factory-repo: ../ai-factory
commands:
  typecheck: pnpm typecheck
  lint: pnpm lint
  test: pnpm test
  acceptance: pnpm test:integration
paths:
  backend:
    - src/routes/**
    - src/services/**
    - src/repository/**
    - prisma/**
  tests:
    - tests/integration/**
platforms:
  - claude-code
```

Then run from your project repo:

```bash
npx tsx /path/to/ai-factory/src/cli.ts install
```

Or with the global install (once it's published):

```bash
factory install
```

This reads your manifest, loads the matching profile, and writes platform-specific files (e.g., `.claude/agents/*.md` + `CLAUDE.md` for Claude Code).

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
- Default paths (which the manifest can override)
- Default commands (which the manifest can override)

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
