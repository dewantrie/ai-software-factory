import { mkdirSync, writeFileSync, existsSync, unlinkSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "../manifest.js";
import type { PromptFile } from "../render.js";
import type { PlatformAdapter } from "./index.js";
import { buildContextFile, render } from "../render.js";
import { ALLOW_KEY_BY_AGENT, scopeConfig, hasScopeToEnforce } from "../util/scope.js";
import { descriptionFor } from "../util/agent-meta.js";

// Reuses the SAME guard as Claude Code: it reads a PreToolUse JSON payload from
// stdin and exits 2 to block. Verified against Kiro CLI (payload has tool_name
// "fs_write" and tool_input.path; exit 2 blocks the write).
const GUARD_ASSET_PATH = fileURLToPath(new URL("../../assets/factory-guard.mjs", import.meta.url));
const CONTEXT_FILE = ".kiro/steering/project.md";

/**
 * Kiro adapter. Generates two complementary surfaces:
 *
 * IDE (`.kiro/steering/`):
 *   - `project.md` — always-included context (manifest + profile)
 *   - `agent-<name>.md` × N — manual-inclusion agent prompts (`#agent-<name>`)
 *   - `skill-<name>.md` × N — manual-inclusion orchestrators (`#skill-<name>`)
 * In the IDE the chain runs semi-manually and path scoping is prompt-only (no
 * generatable IDE hook contract).
 *
 * CLI (`.kiro/agents/*.json`):
 *   - one Kiro CLI agent per agent prompt (`kiro-cli chat --agent <name>`).
 *   - editing agents whose allow-list is declared carry a `preToolUse` hook that
 *     runs `.kiro/factory-guard.mjs` — ENFORCED path scoping (exit 2 blocks the
 *     write, same guard as Claude Code), verified against kiro-cli.
 *
 * Plus `.kiro/FACTORY.md` explaining both surfaces.
 */
export const kiro: PlatformAdapter = {
  name: "kiro",
  contextFileName: ".kiro/steering/project.md",

  async generate({ targetRoot, manifest, agents, skills, profileBody }) {
    const filesWritten: string[] = [];

    const platformVars = {
      CONTEXT_FILE,
    };

    // 1. Project context — always-included steering file
    const contextBody = buildContextFile({
      manifest,
      profileBody,
      contextFileName: CONTEXT_FILE,
      title: `Project context — ${manifest.name}`,
    });
    const projectFile = wrapSteering("always", contextBody);
    writeFile(join(targetRoot, ".kiro", "steering", "project.md"), projectFile);
    filesWritten.push(join(targetRoot, ".kiro", "steering", "project.md"));

    // 2. Agents — manual-inclusion steering files (invoke via #agent-<name>)
    for (const agent of agents) {
      const body = render(agent.body, platformVars);
      const file = wrapSteering("manual", body);
      const path = join(targetRoot, ".kiro", "steering", `agent-${agent.name}.md`);
      writeFile(path, file);
      filesWritten.push(path);
    }

    // 3. Skills — manual-inclusion steering files (invoke via #skill-<name>)
    for (const skill of skills) {
      const body = render(skill.body, platformVars);
      const file = wrapSteering("manual", body);
      const path = join(targetRoot, ".kiro", "steering", `skill-${skill.name}.md`);
      writeFile(path, file);
      filesWritten.push(path);
    }

    // 4. Kiro CLI agents — one JSON per agent (kiro-cli chat --agent <name>).
    //    Editing agents whose allow-list is declared get an ENFORCED preToolUse hook.
    for (const agent of agents) {
      const file = JSON.stringify(cliAgentConfig(agent, manifest), null, 2) + "\n";
      const path = join(targetRoot, ".kiro", "agents", `${agent.name}.json`);
      writeFile(path, file);
      filesWritten.push(path);
    }

    // 5. Path-scope data + guard (referenced by the CLI agents' hooks). No-op when
    //    the manifest declares no scope; removes stale copies in that case.
    const config = scopeConfig(manifest);
    const scopeJsonPath = join(targetRoot, ".kiro", "factory-scope.json");
    const guardPath = join(targetRoot, ".kiro", "factory-guard.mjs");
    if (hasScopeToEnforce(config)) {
      writeFile(scopeJsonPath, JSON.stringify(config, null, 2) + "\n");
      filesWritten.push(scopeJsonPath);
      mkdirSync(dirname(guardPath), { recursive: true });
      copyFileSync(GUARD_ASSET_PATH, guardPath);
      filesWritten.push(guardPath);
    } else {
      if (removeIfExists(scopeJsonPath)) filesWritten.push(scopeJsonPath);
      if (removeIfExists(guardPath)) filesWritten.push(guardPath);
    }

    // 6. FACTORY.md — explains the layout
    const factoryDoc = buildFactoryDoc(manifest, agents.length, skills.length);
    const factoryPath = join(targetRoot, ".kiro", "FACTORY.md");
    writeFile(factoryPath, factoryDoc);
    filesWritten.push(factoryPath);

    return { filesWritten, filesSkipped: [] };
  },
};

function wrapSteering(inclusion: "always" | "manual", body: string): string {
  return ["---", `inclusion: ${inclusion}`, "---", "", body.trim(), ""].join("\n");
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function removeIfExists(path: string): boolean {
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/** Build a Kiro CLI agent config (.kiro/agents/<name>.json) for one agent. */
function cliAgentConfig(agent: PromptFile, manifest: Manifest): Record<string, unknown> {
  const allowKey = ALLOW_KEY_BY_AGENT[agent.name];
  const isEditing = allowKey !== undefined;
  // Editing agents need write + shell (to run validation commands); read-only agents don't.
  const tools = isEditing ? ["read", "write", "shell", "grep", "glob"] : ["read", "grep", "glob"];

  const config: Record<string, unknown> = {
    name: agent.name,
    description: descriptionFor(agent.name),
    prompt: render(agent.body, { CONTEXT_FILE }).trim(),
    tools,
    resources: [`file://${CONTEXT_FILE}`],
  };

  // Opt-in enforcement: only when this agent's allow-list is present in the manifest.
  if (isEditing && manifest.paths[allowKey] !== undefined) {
    config.hooks = {
      preToolUse: [{ matcher: "fs_write", command: `node .kiro/factory-guard.mjs ${agent.name}` }],
    };
  }
  return config;
}

function buildFactoryDoc(manifest: Manifest, numAgents: number, numSkills: number): string {
  return `# AI Factory in Kiro

Generated by ai-factory for **${manifest.name}** (layer: ${manifest.layer}, profile: ${manifest.profile}).

Do not hand-edit \`.kiro/steering/*\` — re-run \`factory install\` after editing \`.factory.yaml\` or the profile.

## What's here

Two surfaces — the **IDE** (steering) and the **CLI** (agents):

- \`steering/project.md\` — always-included project context (architecture rules, commands, path scoping, don't-do list). Kiro injects this into every chat session.
- \`steering/agent-*.md\` — ${numAgents} manual-inclusion agent prompts. Invoke by typing \`#agent-<name>\` in Kiro IDE chat.
- \`steering/skill-*.md\` — ${numSkills} manual-inclusion orchestrator scripts. Invoke by typing \`#skill-<name>\`.
- \`agents/*.json\` — ${numAgents} **Kiro CLI** agent configs. Run with \`kiro-cli chat --agent <name>\`.
- \`factory-scope.json\` + \`factory-guard.mjs\` — the path-scope guard the CLI agents' hooks call (only present when \`.factory.yaml\` declares \`paths\`/\`forbidden\`).

## Path scoping — enforced on the CLI

On **Kiro CLI**, path scoping is **enforced**, not just advised. Each editing agent's config carries a \`preToolUse\` hook on the \`fs_write\` tool that runs \`.kiro/factory-guard.mjs\`: a write to a path outside that agent's allow-list (or matching \`forbidden\`) is **blocked before it happens** (the hook exits 2; the reason is returned to the model). Same guard as Claude Code's PreToolUse hook, verified against \`kiro-cli\`.

- Opt-in: an agent gets the hook only when its allow-list is declared in \`.factory.yaml\` (an agent with no list is prompt-only). Requires \`node\` on PATH.
- Boundary: the hook guards \`fs_write\`. A builder also has the \`shell\` tool, so a \`shell\`-written file can bypass the hook (same guardrail-not-sandbox boundary as Claude's Bash). For *prevention* of shell writes, deny the \`shell\` tool in the agent config or use Kiro CLI permission tiers.
- **IDE caveat:** the Kiro IDE advertises a \`Pre Tool Use\` hook but its on-disk/block contract isn't documented, and the declarative \`toolsSettings.allowedPaths\` is reportedly **not enforced** (kirodotdev/Kiro#7799). So in the IDE flow, scoping stays **prompt-only** — use the CLI agents for enforced scoping.

## How the chain runs in Kiro

Kiro does not have a Claude-Code-style subagent system, so the chain runs **semi-manually**. The skill file describes the sequence; you (or Kiro's agentic chat) invoke each agent in order, pasting prior output forward.

### Tier 3 — full feature (\`#skill-feature-factory\`)

1. Open Kiro chat. Type:
   \`\`\`
   #skill-feature-factory build invoice reminders for invoices unpaid > 7 days
   \`\`\`
2. Follow the skill's instructions. Each step calls a specific agent in this order:
   \`#agent-researcher\` → \`#agent-story-writer\` → **(approve story)** → \`#agent-spec-writer\` → **(approve brief)** → \`#agent-migration-author\` (skip if no schema changes) → \`#agent-backend-builder\` → \`#agent-frontend-builder\` (skip if backend-only) → \`#agent-devops-builder\` (skip if no infra) → \`#agent-test-verifier\` → \`#agent-security-reviewer\` → \`#agent-performance-reviewer\` → \`#agent-validator\` → \`#agent-doc-writer\`.
3. Review the final diff and open the PR.

### Tier 2 — small change (\`#skill-quick-fix\`)

\`#skill-quick-fix fix the invoice PDF missing the tenant address\` — single builder, faster path.

### Tier 1 — research only (\`#skill-spike\`)

\`#skill-spike how do we handle Stripe webhook retries?\` — read-only investigation.

## Limitations vs. Claude Code

- **IDE chain runs semi-manually.** In the IDE each agent is a separate \`#\`-mention; the CLI (\`--agent\`) runs one agent per invocation.
- **IDE path scoping is prompt-only.** Enforced scoping is available on the **CLI** (see above), not the IDE.
- **No automatic checkpoint pauses / fix loops.** The skill text tells the user to stop; you must respect those stops yourself.

## Regenerating

\`\`\`bash
factory install
\`\`\`

Edit \`.factory.yaml\` in the repo root, then re-run. Everything under \`.kiro/steering/\`, \`.kiro/agents/\`, and the scope guard is overwritten.
`;
}
