import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { PlatformAdapter } from "./index.js";
import { buildContextFile, render } from "../render.js";

const TOOLS_BY_AGENT: Record<string, string> = {
  researcher: "Read, Grep, Glob",
  "story-writer": "Read",
  "spec-writer": "Read, Grep, Glob",
  "migration-author": "Read, Edit, Write, Bash, Grep, Glob",
  "backend-builder": "Read, Edit, Write, Bash, Grep, Glob",
  "frontend-builder": "Read, Edit, Write, Bash, Grep, Glob",
  "devops-builder": "Read, Edit, Write, Bash, Grep, Glob",
  "test-verifier": "Read, Edit, Write, Bash, Grep, Glob",
  "security-reviewer": "Read, Grep, Glob",
  "performance-reviewer": "Read, Grep, Glob",
  validator: "Read, Grep, Glob",
  "doc-writer": "Read, Edit, Write, Grep, Glob",
};

const DESCRIPTIONS_BY_AGENT: Record<string, string> = {
  researcher: "Read-only codebase mapper. Invoke first in any feature, fix, or spike.",
  "story-writer": "Turns a rough feature request into a user story with acceptance criteria. Read-only.",
  "spec-writer": "Turns an approved story into a technical brief. Read-only.",
  "migration-author": "Writes DB schema migrations safely (backfill-before-NOT-NULL, online indexes, drop-column dance). Scoped to migrations paths only. Skips if the brief has no data model changes.",
  "backend-builder": "Implements backend-only changes per CLAUDE.md path scoping. Cannot touch frontend or migrations.",
  "frontend-builder": "Implements frontend-only changes per CLAUDE.md path scoping. Consumes backend's API contract verbatim.",
  "devops-builder": "Implements CI/CD and IaC changes (GitHub Actions, Terraform, Helm, Docker). Scoped to infra paths only. Skips if the brief has no infra changes.",
  "test-verifier": "Writes acceptance tests against the user story. Edits only test files.",
  "security-reviewer": "Read-only OWASP-flavored security audit. Reports findings by severity (Critical / Important / Minor) with file:line.",
  "performance-reviewer": "Read-only performance audit. N+1 queries, unbounded loops, hot-path issues. Reports findings by severity with file:line.",
  validator: "Compares implementation against story + brief. Read-only. Reports gaps by severity. Security and performance concerns are delegated to dedicated reviewers.",
  "doc-writer": "Writes CHANGELOG entries, README updates, migration guides for breaking changes. Scoped to docs paths only.",
};

export const claudeCode: PlatformAdapter = {
  name: "claude-code",
  contextFileName: "CLAUDE.md",

  async generate({ targetRoot, manifest, agents, skills, profileBody }) {
    const filesWritten: string[] = [];

    // 1. Write CLAUDE.md at repo root
    const contextBody = buildContextFile({
      manifest,
      profileBody,
      contextFileName: "CLAUDE.md",
      platform: "claude-code",
    });
    const contextPath = join(targetRoot, "CLAUDE.md");
    writeFile(contextPath, contextBody);
    filesWritten.push(contextPath);

    // 2. Write each agent to .claude/agents/<name>.md with Claude Code frontmatter
    const platformVars = {
      CONTEXT_FILE: "CLAUDE.md",
      PLATFORM_HINT:
        "On Claude Code, this agent is invoked via the `Agent` tool with subagent_type. Tool scoping is enforced by the `tools:` frontmatter — paths are not enforced at the tool level, only by prompt + the scope rules in CLAUDE.md.",
    };
    for (const agent of agents) {
      const tools = TOOLS_BY_AGENT[agent.name] ?? "Read";
      const description = DESCRIPTIONS_BY_AGENT[agent.name] ?? `${agent.name} agent.`;
      const body = render(agent.body, platformVars);
      const file = [
        "---",
        `name: ${agent.name}`,
        `description: ${description}`,
        `tools: ${tools}`,
        "---",
        "",
        body.trim(),
        "",
      ].join("\n");
      const path = join(targetRoot, ".claude", "agents", `${agent.name}.md`);
      writeFile(path, file);
      filesWritten.push(path);
    }

    // 3. Write each skill to .claude/skills/<name>/SKILL.md
    for (const skill of skills) {
      const body = render(skill.body, platformVars);
      const description = extractDescription(body) ?? `${skill.name} orchestrator.`;
      const file = ["---", `description: ${description}`, "---", "", body.trim(), ""].join("\n");
      const path = join(targetRoot, ".claude", "skills", skill.name, "SKILL.md");
      writeFile(path, file);
      filesWritten.push(path);
    }

    return { filesWritten, filesSkipped: [] };
  },
};

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function extractDescription(body: string): string | null {
  // Try to pull a one-liner from the prompt body's intro
  const firstParagraph = body.trim().split("\n\n")[0] ?? "";
  const cleaned = firstParagraph.replace(/^#+\s+.*$/m, "").trim().split("\n")[0]?.trim();
  if (!cleaned) return null;
  return cleaned.length > 250 ? cleaned.slice(0, 247) + "..." : cleaned;
}
