# 02 — The Install Pipeline

This chapter traces exactly what happens when you run `factory install`. If you
understand this flow, you understand the whole tool — everything else is a variation.

## The command surface

`src/cli.ts` (Commander) exposes five commands:

| Command | Source | What it does |
|---|---|---|
| `factory init` | `src/commands/init.ts` | Interactive wizard → writes `.factory.yaml` |
| `factory install` | `src/commands/install.ts` | Generates platform files for one repo |
| `factory sync` | `src/commands/sync.ts` | Runs `install` for every repo in a workspace file |
| `factory feature …` | `src/commands/feature.ts` | Cross-repo contract bridge (Chapter [07](07-cross-repo.md)) |

`install` is the heart. `sync` is just `install` in a loop. `init` is a convenience
that writes a manifest. So we focus on `install`.

## install, step by step

Read `src/commands/install.ts` alongside this.

```
factory install
   │
   1. loadManifest(".factory.yaml")        ── src/manifest.ts
   │      parse YAML → validate required fields + layer enum → normalize
   │
   2. loadPrompts(factoryRoot)             ── src/render.ts
   │      read prompts/agents/*.md  → PromptFile[]
   │      read prompts/skills/*.md  → PromptFile[]
   │
   3. loadProfile(factoryRoot, manifest.profile)   ── src/render.ts
   │      read profiles/<profile>.md → string
   │
   4. for each platform in manifest.platforms:
   │      adapter = getAdapter(platform)   ── src/platforms/index.ts
   │      adapter.generate({ targetRoot, manifest, agents, skills, profileBody })
   │
   └─ each failed platform is caught and logged; others continue
```

Two design choices worth noting here:

1. **The factory root is found relative to the CLI, not the manifest.** `cli.ts`
   computes `DEFAULT_FACTORY_ROOT` from its own location. This is why a globally-linked
   `factory` binary can be run from any project directory and still find its prompts and
   profiles. (See `bin/factory.mjs` — a tsx-spawn shim so there's no build step.)

2. **Per-platform failures are isolated.** `install.ts` wraps each `adapter.generate`
   in try/catch and logs failures rather than aborting. Generating Kiro files should not
   be blocked by a Codex problem. The trade-off: an install can "succeed" having written
   nothing for a broken platform — read the output, don't just trust the exit.

## Inside the Claude Code adapter

`src/platforms/claude-code.ts` is the reference. Its `generate()` writes four kinds of
output:

```
1. CLAUDE.md                         ← buildContextFile(manifest, profileBody)
2. .claude/agents/<name>.md   × 12   ← frontmatter (name/description/tools
                                        [+ per-agent hooks]) + rendered prompt body
3. .claude/skills/<name>/SKILL.md ×3 ← frontmatter (description) + rendered body
4. the path guard                    ← .claude/hooks/factory-scope.json
                                        + .claude/hooks/factory-guard.mjs
                                        + merged .claude/settings.json
```

### How the context file is built

`buildContextFile` in `src/render.ts` assembles `CLAUDE.md` in a fixed section order:

```
# CLAUDE.md
Repo identity (name, layer, profile)
## Commands              (from manifest.commands)
## Path scoping for agents   (from manifest.paths — Backend/Frontend/Migration/DevOps/Test/Doc/Forbidden)
## Profile rules         (profile body, inlined verbatim)
## Repo-specific don't-do   (manifest.dontDo, if any)
## Notes                 (manifest.notes, if any)
```

The order is stable and tested (`test/render.test.ts`) because downstream tooling and
humans rely on it.

### How agent files are built

For each prompt, the adapter:

1. Looks up tools from `TOOLS_BY_AGENT` (read-only agents get `Read, Grep, Glob`;
   builders also get `Edit, Write, Bash`).
2. Looks up a curated one-line `description` from `DESCRIPTIONS_BY_AGENT`.
3. Substitutes `{{CONTEXT_FILE}}` → `CLAUDE.md` via `render()`.
4. Appends a per-agent `hooks:` block **iff** that agent has an allow-list in the
   manifest (Chapter [04](04-path-enforcement.md)).

### How skill descriptions are derived

Skills don't have a curated description map; `extractDescription()` pulls the first real
prose paragraph from the prompt body (skipping the leading `# Heading`). This is the
text Claude uses to decide when to auto-invoke the skill, so getting it right matters —
a subtle bug once made every skill fall back to "`<name> orchestrator.`", which is
useless for auto-triggering. Lesson: the description is a feature, not a label.

## What `sync` adds

`src/commands/sync.ts` loads a workspace file (`factory.workspace.yaml`, a list of repo
paths), then calls `install` for each. It skips repos with no manifest, continues past
per-repo failures, and exits non-zero if any failed. This is the "fix once, apply
everywhere" lever from Chapter [00](00-introduction.md) made real.

## What gets overwritten vs preserved

Every `install` regenerates the generated files (`CLAUDE.md`, `.claude/agents/*`, the
guard). It **never** touches `.factory.yaml`, your source code, or `.codex/runs/**`. The
`.claude/settings.json` is **merged**, not overwritten — only the factory's guard hook
entry is added/refreshed; your other settings survive.

The hard rule that falls out of this: **never hand-edit a generated file.** Your edit
vanishes on the next install. Edit the manifest, the profile, or the prompt instead.

Next: [03 — The agent chain](03-the-agent-chain.md).
