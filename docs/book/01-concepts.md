# 01 — The Four Primitives

Everything in ai-factory is one of four things. Learn these and the rest is detail.

```
   PROMPTS            PROFILE             MANIFEST
 (process, neutral) (per-stack rules)  (per-repo facts)
        \                |                  /
         \               |                 /
          ─────────►  ADAPTER  ◄──────────
                  (render + write files)
                          │
                          ▼
          CLAUDE.md, .claude/agents/*, hooks, …
```

## 1. Prompts — *the process*, platform- and stack-neutral

Location: `prompts/agents/*.md` (12 agents) and `prompts/skills/*.md` (3 skills).

A prompt describes a **role** ("You are the Backend Builder…") and the discipline it
must follow (read scope first, write tests, run validation, output a structured
summary). It deliberately contains:

- **No stack details.** It never says "run `pnpm test`" — it says "run the test
  command listed in `{{CONTEXT_FILE}}`."
- **No platform details.** The only seam is the template variable `{{CONTEXT_FILE}}`,
  which the adapter substitutes (`CLAUDE.md`, `AGENTS.md`, `.kiro/steering/project.md`).

Why neutral? Because a prompt written once must work in every repo on every platform.
The moment a prompt hard-codes `pnpm` or "Claude Code", it stops being reusable and you
are back to per-repo copies. The neutrality is the whole point — protect it.

> **Rule of thumb:** if you're tempted to put a command, a path, or a tool name in a
> prompt, stop. That belongs in the manifest or the profile.

## 2. Profile — *per-stack rules and conventions*

Location: `profiles/*.md` (e.g. `node-fastify.md`, `nextjs-app-router.md`).

A profile is the opinionated rule pack for one stack: architecture rules ("business
logic in `src/services/`, handlers stay thin"), a don't-do list, naming conventions,
and **default** paths/commands. The profile body is **inlined verbatim** into the
generated context file under a `## Profile rules` heading.

One subtlety that trips people up: the `Default paths` / `Default commands` YAML blocks
inside a profile are **documentation only**. They are *not* read at install time. They
exist so `factory init` can pre-fill a new manifest, and so a human copying the profile
knows a sane starting point. The values that actually drive generation come from the
**manifest**. (See Chapter [06](06-profiles.md) for why it's split this way.)

## 3. Manifest — *the per-repo facts*

Location: `.factory.yaml` in each project repo. Parsed by `src/manifest.ts`.

This is the only file that lives in the *project* repo, and it's tiny (~20 lines). It
declares the facts that are true for *this* repo and nothing more:

```yaml
name: billing-api
layer: backend                 # backend | frontend | worker | mobile | fullstack
profile: node-fastify          # which profile to inline
commands:                      # the real commands agents must run
  typecheck: pnpm typecheck
  lint: pnpm lint
  test: pnpm test
paths:                         # who may edit what (drives scoping + the guard)
  backend: [src/routes/**, src/services/**]
  migrations: [prisma/**]
  forbidden: [.env*, "**/secrets.*"]
platforms: [claude-code, kiro, codex]
```

The manifest is **never overwritten** by `install`. It is the one file a repo owner
hand-edits. Everything else is generated from it.

The `Manifest` / `Paths` TypeScript types in `src/manifest.ts` are the schema. The
`paths` keys (`backend`, `frontend`, `tests`, `migrations`, `infra`, `docs`, `shared`,
`forbidden`) map to specific agents — see Chapter [04](04-path-enforcement.md).

## 4. Adapter — *the renderer for one platform*

Location: `src/platforms/*.ts`. Contract: `PlatformAdapter` in `src/platforms/index.ts`.

An adapter knows how *one* AI platform wants its files laid out, and emits them:

```ts
export interface PlatformAdapter {
  name: Platform;
  contextFileName: string;            // e.g. "CLAUDE.md"
  generate(args: {
    targetRoot: string;
    manifest: Manifest;
    agents: PromptFile[];
    skills: PromptFile[];
    profileBody: string;
  }): Promise<PlatformWriteResult>;
}
```

`claude-code.ts` is the reference adapter; `kiro.ts` and `codex.ts` are the other two.
Chapter [05](05-adapters.md) covers them and how to add another.

## The glue: render

`src/render.ts` is the small composition layer between primitives and adapters:

- `loadPrompts(factoryRoot)` reads `prompts/agents/*` and `prompts/skills/*`.
- `loadProfile(factoryRoot, name)` reads one profile body.
- `render(body, vars)` substitutes `{{VAR}}` template variables.
- `buildContextFile(ctx)` composes manifest + profile into the platform's context
  document (the `CLAUDE.md`-equivalent), including the "Path scoping for agents" and
  "Profile rules" sections.

## Why four, and only four

Each primitive isolates one axis of change:

| If this changes… | …edit only this |
|---|---|
| The *process* (how the validator works) | a prompt |
| The *stack* conventions (how Fastify apps are structured) | a profile |
| The *facts* of one repo (its commands, its paths) | that repo's manifest |
| The *platform* output shape (what Kiro expects) | an adapter |

A change never has to touch more than one axis. That separation is what makes the
system teachable and safe to extend. Chapter [08](08-extending.md) is built entirely on it.

Next: [02 — The install pipeline](02-the-pipeline.md).
