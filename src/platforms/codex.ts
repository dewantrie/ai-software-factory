import { mkdirSync, writeFileSync, chmodSync, copyFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "../manifest.js";
import type { PlatformAdapter } from "./index.js";
import { buildContextFile, render } from "../render.js";
import { scopeConfig, hasScopeToEnforce } from "../util/scope.js";

// Codex post-run scope checker — copied verbatim into .codex/ and invoked by the
// orchestrator after each editing agent. Resolved relative to this module so it
// works under tsx-on-src and a dist build alike.
const CHECK_ASSET_PATH = fileURLToPath(new URL("../../assets/factory-check.mjs", import.meta.url));

/**
 * OpenAI Codex CLI adapter.
 *
 * Generates:
 *   - AGENTS.md (repo root)                — auto-loaded project context
 *   - .codex/agents/<name>.md         × N  — agent prompt bodies, one per prompts/agents/* (read by orchestrator)
 *   - .codex/orchestrator/<skill>.sh  × N  — bash chains using `codex exec`, one per prompts/skills/*
 *   - .codex/FACTORY.md                    — explains the layout and usage
 *
 * The orchestrator scripts implement the chain logic in shell:
 *   - Each agent runs as a separate `codex exec` invocation.
 *   - Outputs are captured and saved under .codex/runs/<timestamp>/.
 *   - Checkpoints pause via `read -p` for human approval.
 *   - Inter-agent context is passed as concatenated text in each prompt.
 *
 * Current scope: no automated fix loops; if validator/test-verifier reports
 * failures, the user re-runs or fixes manually. A future iteration can add loop logic.
 */
export const codex: PlatformAdapter = {
  name: "codex",
  contextFileName: "AGENTS.md",

  async generate({ targetRoot, manifest, agents, skills, profileBody }) {
    const filesWritten: string[] = [];

    const platformVars = { CONTEXT_FILE: "AGENTS.md" };

    // 1. AGENTS.md at root
    const contextBody = buildContextFile({
      manifest,
      profileBody,
      contextFileName: "AGENTS.md",
      title: `AGENTS.md — ${manifest.name}`,
    });
    const agentsPath = join(targetRoot, "AGENTS.md");
    writeFile(agentsPath, contextBody);
    filesWritten.push(agentsPath);

    // 2. Agent prompt files
    for (const agent of agents) {
      const body = render(agent.body, platformVars);
      const path = join(targetRoot, ".codex", "agents", `${agent.name}.md`);
      writeFile(path, body.trim() + "\n");
      filesWritten.push(path);
    }

    // 3. Bash orchestrator scripts (one per skill)
    const skillNames = new Set(skills.map((s) => s.name));

    if (skillNames.has("feature-factory")) {
      const p = join(targetRoot, ".codex", "orchestrator", "feature-factory.sh");
      writeExecutable(p, featureFactoryScript());
      filesWritten.push(p);
    }
    if (skillNames.has("quick-fix")) {
      const p = join(targetRoot, ".codex", "orchestrator", "quick-fix.sh");
      writeExecutable(p, quickFixScript());
      filesWritten.push(p);
    }
    if (skillNames.has("spike")) {
      const p = join(targetRoot, ".codex", "orchestrator", "spike.sh");
      writeExecutable(p, spikeScript());
      filesWritten.push(p);
    }

    // 4. Path-scope enforcement data + checker (the orchestrator's enforce_scope
    //    step is a no-op unless both of these exist; see scopeHelpers()).
    const config = scopeConfig(manifest);
    const scopeJsonPath = join(targetRoot, ".codex", "factory-scope.json");
    const checkPath = join(targetRoot, ".codex", "factory-check.mjs");
    if (hasScopeToEnforce(config)) {
      writeFile(scopeJsonPath, JSON.stringify(config, null, 2) + "\n");
      filesWritten.push(scopeJsonPath);
      mkdirSync(dirname(checkPath), { recursive: true });
      copyFileSync(CHECK_ASSET_PATH, checkPath);
      filesWritten.push(checkPath);
    } else {
      if (removeIfExists(scopeJsonPath)) filesWritten.push(scopeJsonPath);
      if (removeIfExists(checkPath)) filesWritten.push(checkPath);
    }

    // 5. FACTORY.md
    const factoryPath = join(targetRoot, ".codex", "FACTORY.md");
    writeFile(factoryPath, buildFactoryDoc(manifest, agents.length));
    filesWritten.push(factoryPath);

    return { filesWritten, filesSkipped: [] };
  },
};

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeExecutable(path: string, content: string): void {
  writeFile(path, content);
  chmodSync(path, 0o755);
}

function removeIfExists(path: string): boolean {
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/**
 * Bash helpers injected into every orchestrator: a per-agent path-scope guard,
 * the version-independent analog of Claude Code's PreToolUse hook. After an
 * editing agent runs, it diffs that agent's changes and reverts + halts on any
 * file outside the agent's allow-list or matching the forbidden list. It is a
 * NO-OP unless `.codex/factory-check.mjs` + `.codex/factory-scope.json` exist
 * (i.e. the manifest declared scope) AND node + a git repo are available.
 * Written with real `$` (interpolated verbatim into the `\$`-escaped scripts).
 */
function scopeHelpers(): string {
  return `
# --- path-scope enforcement (no-op unless scope files + node + git are present) ---
scope_active() {
  [ -f "$CODEX_DIR/factory-check.mjs" ] && [ -f "$CODEX_DIR/factory-scope.json" ] \\
    && command -v node >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1
}

# All currently-changed paths: modified-tracked + new-untracked (gitignore respected).
_changed_now() {
  { git diff --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u
}

snapshot() {
  # Records the changed-set BEFORE an agent runs, in a temp file; echoes its path.
  scope_active || { echo ""; return 0; }
  local f
  f=$(mktemp)
  _changed_now > "$f"
  echo "$f"
}

enforce_scope() {
  # $1 = agent name, $2 = path returned by snapshot()
  scope_active || return 0
  local agent="$1" before="$2"
  [ -z "$before" ] && return 0
  # Files this agent created or modified = (changed now) minus (changed before).
  local delta
  delta=$(comm -13 "$before" <(_changed_now) 2>/dev/null || true)
  rm -f "$before"
  [ -z "$delta" ] && return 0
  local violations
  if violations=$(printf '%s\\n' "$delta" | node "$CODEX_DIR/factory-check.mjs" "$agent"); then
    return 0
  fi
  echo "" >&2
  echo "Scope violation: $agent edited files outside its allowed paths. Reverting and halting." >&2
  printf '%s\\n' "$violations" | while IFS= read -r f; do
    [ -z "$f" ] && continue
    git checkout HEAD -- "$f" 2>/dev/null || rm -f "$f"
  done
  echo "Reverted out-of-scope files. Tighten the brief or the manifest paths, then re-run." >&2
  exit 1
}
`;
}

/* ------- Bash orchestrator scripts ------- */

function featureFactoryScript(): string {
  return `#!/usr/bin/env bash
# Feature Factory — Tier 3 (full 12-agent chain)
# Generated by ai-factory. Re-run \`factory install\` to regenerate.
set -euo pipefail

if [ \$# -eq 0 ]; then
  echo "Usage: \$0 <feature description>"
  echo ""
  echo "Example: \$0 build invoice reminders for invoices unpaid > 7 days"
  exit 1
fi

REQUEST="\$*"
RUN_DIR=".codex/runs/\$(date +%Y%m%d-%H%M%S)-feature"
mkdir -p "\$RUN_DIR"
echo "\$REQUEST" > "\$RUN_DIR/request.txt"

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
CODEX_DIR="\$(dirname "\$SCRIPT_DIR")"

invoke() {
  local agent_name="\$1"
  local prompt_input="\$2"
  local agent_file="\$CODEX_DIR/agents/\$agent_name.md"

  if [ ! -f "\$agent_file" ]; then
    echo "ERROR: agent prompt file not found: \$agent_file" >&2
    exit 1
  fi

  codex exec "\$(cat "\$agent_file")

---

\$prompt_input"
}

section() { echo ""; echo "===== \$1 ====="; echo ""; }

pause_for_approval() {
  echo ""
  read -p "⏸ \$1 (yes / no / edit-then-rerun): " response
  if [ "\$response" != "yes" ] && [ "\$response" != "y" ]; then
    echo "Halted. Outputs in: \$RUN_DIR"
    exit 1
  fi
}
${scopeHelpers()}
# ----- STEP 1: Researcher -----
section "STEP 1 — Researcher"
RESEARCH=\$(invoke researcher "User request: \$REQUEST")
echo "\$RESEARCH" | tee "\$RUN_DIR/01-researcher.md"

# ----- STEP 2: Story Writer -----
section "STEP 2 — Story Writer"
STORY=\$(invoke story-writer "User request: \$REQUEST

Researcher output:
\$RESEARCH")
echo "\$STORY" | tee "\$RUN_DIR/02-story.md"

pause_for_approval "CHECKPOINT 1: Approve story?"

# ----- STEP 3: Spec Writer -----
section "STEP 3 — Spec Writer"
BRIEF=\$(invoke spec-writer "Approved story:
\$STORY

Researcher output:
\$RESEARCH")
echo "\$BRIEF" | tee "\$RUN_DIR/03-brief.md"

pause_for_approval "CHECKPOINT 2: Approve brief?"

# ----- STEP 4: Migration Author -----
# Returns "Not applicable" if the brief has no schema changes.
section "STEP 4 — Migration Author"
SNAP=\$(snapshot)
MIGRATION=\$(invoke migration-author "Approved brief:
\$BRIEF

Researcher output:
\$RESEARCH")
echo "\$MIGRATION" | tee "\$RUN_DIR/04-migration.md"
enforce_scope migration-author "\$SNAP"

# ----- STEP 5: Backend Builder -----
section "STEP 5 — Backend Builder"
SNAP=\$(snapshot)
BACKEND=\$(invoke backend-builder "Approved brief:
\$BRIEF

Researcher output:
\$RESEARCH

Migration Author output:
\$MIGRATION")
echo "\$BACKEND" | tee "\$RUN_DIR/05-backend.md"
enforce_scope backend-builder "\$SNAP"

# ----- STEP 6: Frontend Builder -----
section "STEP 6 — Frontend Builder"
SNAP=\$(snapshot)
FRONTEND=\$(invoke frontend-builder "Approved brief:
\$BRIEF

Researcher output:
\$RESEARCH

Backend Builder output (includes API contract):
\$BACKEND")
echo "\$FRONTEND" | tee "\$RUN_DIR/06-frontend.md"
enforce_scope frontend-builder "\$SNAP"

# ----- STEP 7: DevOps Builder -----
# Returns "Not applicable" if the brief has no infra/CI changes.
section "STEP 7 — DevOps Builder"
SNAP=\$(snapshot)
DEVOPS=\$(invoke devops-builder "Approved brief:
\$BRIEF

Researcher output:
\$RESEARCH")
echo "\$DEVOPS" | tee "\$RUN_DIR/07-devops.md"
enforce_scope devops-builder "\$SNAP"

# ----- STEP 8: Test Verifier -----
section "STEP 8 — Test Verifier"
SNAP=\$(snapshot)
TEST=\$(invoke test-verifier "Approved story:
\$STORY

Approved brief:
\$BRIEF

Backend Builder summary:
\$BACKEND

Frontend Builder summary:
\$FRONTEND

DevOps Builder summary:
\$DEVOPS")
echo "\$TEST" | tee "\$RUN_DIR/08-test.md"
enforce_scope test-verifier "\$SNAP"

# ----- STEP 9: Security Reviewer -----
section "STEP 9 — Security Reviewer"
SECURITY=\$(invoke security-reviewer "Approved story:
\$STORY

Approved brief:
\$BRIEF

Backend Builder summary:
\$BACKEND

Frontend Builder summary:
\$FRONTEND

DevOps Builder summary:
\$DEVOPS")
echo "\$SECURITY" | tee "\$RUN_DIR/09-security.md"

# ----- STEP 10: Performance Reviewer -----
section "STEP 10 — Performance Reviewer"
PERF=\$(invoke performance-reviewer "Approved story:
\$STORY

Approved brief:
\$BRIEF

Backend Builder summary:
\$BACKEND

Frontend Builder summary:
\$FRONTEND")
echo "\$PERF" | tee "\$RUN_DIR/10-performance.md"

# ----- STEP 11: Validator -----
section "STEP 11 — Validator"
VALIDATION=\$(invoke validator "Approved story:
\$STORY

Approved brief:
\$BRIEF

Backend Builder summary:
\$BACKEND

Frontend Builder summary:
\$FRONTEND

DevOps Builder summary:
\$DEVOPS")
echo "\$VALIDATION" | tee "\$RUN_DIR/11-validator.md"

# ----- STEP 12: Doc Writer -----
section "STEP 12 — Doc Writer"
SNAP=\$(snapshot)
DOCS=\$(invoke doc-writer "Approved story:
\$STORY

Approved brief:
\$BRIEF

Backend Builder summary:
\$BACKEND

Frontend Builder summary:
\$FRONTEND

DevOps Builder summary:
\$DEVOPS

Validator findings:
\$VALIDATION

Security Reviewer findings:
\$SECURITY

Performance Reviewer findings:
\$PERF")
echo "\$DOCS" | tee "\$RUN_DIR/12-docs.md"
enforce_scope doc-writer "\$SNAP"

pause_for_approval "CHECKPOINT 3: Review diff and open PR?"

echo ""
echo "Done. All run outputs saved in: \$RUN_DIR"
`;
}

function quickFixScript(): string {
  return `#!/usr/bin/env bash
# Quick Fix — Tier 2 (single-layer change)
# Generated by ai-factory. Re-run \`factory install\` to regenerate.
set -euo pipefail

if [ \$# -eq 0 ]; then
  echo "Usage: \$0 <description>"
  echo ""
  echo "Example: \$0 fix the invoice PDF missing tenant address"
  exit 1
fi

REQUEST="\$*"
RUN_DIR=".codex/runs/\$(date +%Y%m%d-%H%M%S)-quickfix"
mkdir -p "\$RUN_DIR"

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
CODEX_DIR="\$(dirname "\$SCRIPT_DIR")"

invoke() {
  local agent_name="\$1"
  local prompt_input="\$2"
  codex exec "\$(cat "\$CODEX_DIR/agents/\$agent_name.md")

---

\$prompt_input"
}

section() { echo ""; echo "===== \$1 ====="; echo ""; }
${scopeHelpers()}
# ----- STEP 1: Researcher -----
section "STEP 1 — Researcher"
RESEARCH=\$(invoke researcher "User request: \$REQUEST")
echo "\$RESEARCH" | tee "\$RUN_DIR/01-researcher.md"

# ----- CHECKPOINT: pick builder based on plan -----
echo ""
read -p "⏸ Plan above. Builder to use (backend / frontend): " BUILDER

case "\$BUILDER" in
  backend|be) AGENT=backend-builder ;;
  frontend|fe) AGENT=frontend-builder ;;
  *) echo "Unknown builder: \$BUILDER. Halting."; exit 1 ;;
esac

# ----- STEP 2: Builder -----
section "STEP 2 — \$AGENT"
SNAP=\$(snapshot)
BUILD=\$(invoke "\$AGENT" "User request: \$REQUEST

Researcher output (treat as mini-spec):
\$RESEARCH")
echo "\$BUILD" | tee "\$RUN_DIR/02-build.md"
enforce_scope "\$AGENT" "\$SNAP"

# ----- STEP 3: Validator -----
section "STEP 3 — Validator"
VALIDATION=\$(invoke validator "User request (treat as story + brief):
\$REQUEST

Researcher output:
\$RESEARCH

Builder output:
\$BUILD")
echo "\$VALIDATION" | tee "\$RUN_DIR/03-validator.md"

echo ""
echo "Done. All outputs in: \$RUN_DIR"
`;
}

function spikeScript(): string {
  return `#!/usr/bin/env bash
# Spike — Tier 1 (research only)
# Generated by ai-factory. Re-run \`factory install\` to regenerate.
set -euo pipefail

if [ \$# -eq 0 ]; then
  echo "Usage: \$0 <question>"
  echo ""
  echo "Example: \$0 how do we handle Stripe webhook retries?"
  exit 1
fi

REQUEST="\$*"
RUN_DIR=".codex/runs/\$(date +%Y%m%d-%H%M%S)-spike"
mkdir -p "\$RUN_DIR"

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
CODEX_DIR="\$(dirname "\$SCRIPT_DIR")"

echo "===== Researcher ====="
echo ""
RESEARCH=\$(codex exec "\$(cat "\$CODEX_DIR/agents/researcher.md")

---

User question: \$REQUEST")
echo "\$RESEARCH" | tee "\$RUN_DIR/researcher.md"

echo ""
echo "Findings above. No code was changed."
echo "To act on this, use:"
echo "  .codex/orchestrator/quick-fix.sh <your build request>"
echo "  .codex/orchestrator/feature-factory.sh <your build request>"
echo ""
echo "Outputs saved in: \$RUN_DIR"
`;
}

/* ------- FACTORY.md ------- */

function buildFactoryDoc(manifest: Manifest, numAgents: number): string {
  return `# AI Factory for Codex CLI

Generated by ai-factory for **${manifest.name}** (layer: ${manifest.layer}, profile: ${manifest.profile}).

Do not hand-edit \`AGENTS.md\`, \`.codex/agents/*\`, or \`.codex/orchestrator/*\` — re-run \`factory install\` after editing \`.factory.yaml\` or the profile.

## What's here

- \`/AGENTS.md\` (repo root) — Codex CLI auto-loads this. Project identity, commands, path scoping, architecture rules, don't-do list.
- \`.codex/agents/<name>.md\` — ${numAgents} agent prompt bodies. Used by the orchestrator scripts.
- \`.codex/orchestrator/<name>.sh\` — executable bash scripts that chain \`codex exec\` calls with checkpoints.
- \`.codex/runs/<timestamp>-<skill>/\` — created at runtime. Holds each step's output (\`01-researcher.md\`, \`02-story.md\`, etc.) for the run.

## Usage

### Tier 3 — full feature

\`\`\`bash
./.codex/orchestrator/feature-factory.sh build invoice reminders for invoices unpaid > 7 days
\`\`\`

The script invokes (12 agents in this order):
1. researcher → story-writer → **⏸ CHECKPOINT 1** (approve story)
2. spec-writer → **⏸ CHECKPOINT 2** (approve brief)
3. migration-author (returns "Not applicable" if no schema changes)
4. backend-builder → frontend-builder → devops-builder (returns "Not applicable" if no infra)
5. test-verifier
6. security-reviewer → performance-reviewer → validator
7. doc-writer → **⏸ CHECKPOINT 3** (review and open PR)

All outputs saved in \`.codex/runs/<timestamp>-feature/\`.

### Tier 2 — small change

\`\`\`bash
./.codex/orchestrator/quick-fix.sh fix the invoice PDF missing tenant address
\`\`\`

researcher → ⏸ (pick backend or frontend) → builder → validator.

### Tier 1 — research only

\`\`\`bash
./.codex/orchestrator/spike.sh how do we handle Stripe webhook retries?
\`\`\`

researcher only. No code written.

## Path scoping — enforced

Path scoping is **enforced**, not just advised. After each editing agent runs, the
orchestrator diffs that agent's changes (new + modified files) and runs
\`.codex/factory-check.mjs\`: any file outside that agent's allow-list, or matching the
\`forbidden\` list, is **reverted and the chain halts**. This is the version-independent
analog of Claude Code's PreToolUse hook.

- Mechanism differs from Claude: Codex enforcement is **detect-and-revert after** each
  \`codex exec\`, not block-before-the-edit — but the end state is identical (out-of-scope
  edits don't survive). It catches Bash-written files too, since it diffs the tree.
- It's a no-op unless the manifest declares \`paths\`/\`forbidden\` (so \`.codex/factory-scope.json\`
  + \`.codex/factory-check.mjs\` are generated) **and** \`node\` + a git repo are present.
- **Optional stronger layer (current Codex only):** for *prevention* (sandbox-denied writes),
  add a per-agent permission profile to \`.codex/config.toml\` and invoke with
  \`codex --profile <agent> -a never exec …\`:
  \`\`\`toml
  [permissions.backend-builder]
  extends = ":workspace"
  [permissions.backend-builder.filesystem]
  ":workspace_roots" = "write"
  "**/*.env"  = "deny"
  "prisma/**" = "deny"
  \`\`\`
  This feature is new (Codex ≥ v0.135) and version-sensitive, and does **not** compose with
  \`sandbox_mode\` — so the factory does not auto-generate it. The git-diff guard above is the
  default because it works on any Codex version.

## Other limitations vs. Claude Code

- **No automated fix loops.** If validator reports Critical findings or test-verifier reports failing ACs, re-run the chain after fixing, or fix manually.
- **No automatic test/typecheck.** The builders' prompts tell them to run validation commands; the orchestrator script doesn't verify they actually did.
- **Each agent invocation is a fresh \`codex exec\` session.** Context isn't shared — the orchestrator concatenates prior outputs into each prompt explicitly.

## Prerequisites

- \`codex\` CLI installed and authenticated (\`codex login\` if needed).
- Bash 4+ (any modern macOS / Linux).
- \`node\` on PATH and the repo under git — required for the enforced path scoping above (it self-disables otherwise).
- Run scripts from the repo root.

## Regenerating

\`\`\`bash
factory install
\`\`\`

Edit \`.factory.yaml\` in the repo root and re-run. Everything in \`AGENTS.md\`, \`.codex/agents/\`, and \`.codex/orchestrator/\` is overwritten. \`.codex/runs/\` is preserved.
`;
}
