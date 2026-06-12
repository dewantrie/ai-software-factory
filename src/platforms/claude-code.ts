import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Manifest } from "../manifest.js";
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

    // 4. Path guard — a PreToolUse hook that enforces the manifest's `forbidden`
    //    list at the tool level (frontmatter can't scope paths). Edits/writes to a
    //    forbidden path are blocked for EVERY agent, not just trusted by prose.
    writeForbiddenGuard(targetRoot, manifest, filesWritten);

    return { filesWritten, filesSkipped: [] };
  },
};

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function extractDescription(body: string): string | null {
  // Pull the first real prose paragraph as the skill description (Claude uses it
  // to decide when to auto-invoke the skill). Skip leading markdown headings —
  // every prompt starts with a `# Title`, which must NOT become the description.
  const paragraphs = body.trim().split(/\n\s*\n/);
  for (const para of paragraphs) {
    const prose = para
      .split("\n")
      .filter((line) => !/^\s*#{1,6}\s/.test(line)) // drop heading lines
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (prose) {
      return prose.length > 500 ? prose.slice(0, 497) + "..." : prose;
    }
  }
  return null;
}

/* ------- Path guard (PreToolUse hook) ------- */

const GUARD_REL_PATH = ".claude/hooks/factory-guard.mjs";
const SETTINGS_REL_PATH = ".claude/settings.json";
const GUARD_MARKER = "factory-guard.mjs";

/**
 * Generate (or remove) a PreToolUse hook that blocks edits to forbidden paths.
 * - With a non-empty `forbidden` list: writes the guard script and merges the
 *   hook into .claude/settings.json (preserving any other settings/hooks).
 * - With an empty list: strips a previously-generated guard hook, if present.
 */
function writeForbiddenGuard(targetRoot: string, manifest: Manifest, filesWritten: string[]): void {
  const forbidden = manifest.paths.forbidden ?? [];
  const settingsPath = join(targetRoot, SETTINGS_REL_PATH);

  if (forbidden.length === 0) {
    if (removeGuardFromSettings(settingsPath)) filesWritten.push(settingsPath);
    return;
  }

  const scriptPath = join(targetRoot, GUARD_REL_PATH);
  writeFile(scriptPath, guardScript(forbidden));
  filesWritten.push(scriptPath);

  mergeGuardIntoSettings(settingsPath);
  filesWritten.push(settingsPath);
}

interface HookCommand {
  type: string;
  command: string;
}
interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
}

function isOurHook(entry: HookEntry): boolean {
  return (entry.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(GUARD_MARKER));
}

function readSettings(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    // Unparseable user settings — don't clobber; start from empty and the merge
    // will surface as a fresh file rather than throwing.
    return {};
  }
}

function mergeGuardIntoSettings(settingsPath: string): void {
  const settings = readSettings(settingsPath);
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  const preToolUse = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];

  const others = preToolUse.filter((e) => !isOurHook(e));
  others.push({
    matcher: "Write|Edit|MultiEdit|NotebookEdit",
    hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR/${GUARD_REL_PATH}"` }],
  });

  hooks.PreToolUse = others;
  settings.hooks = hooks;
  writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

/** Returns true if it modified the file. */
function removeGuardFromSettings(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return false;
  const settings = readSettings(settingsPath);
  const hooks = settings.hooks as Record<string, HookEntry[]> | undefined;
  if (!hooks || !Array.isArray(hooks.PreToolUse)) return false;

  const kept = hooks.PreToolUse.filter((e) => !isOurHook(e));
  if (kept.length === hooks.PreToolUse.length) return false; // nothing of ours

  if (kept.length > 0) hooks.PreToolUse = kept;
  else delete hooks.PreToolUse;
  if (Object.keys(hooks).length === 0) delete settings.hooks;

  writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

function guardScript(forbidden: string[]): string {
  const list = JSON.stringify(forbidden);
  return `#!/usr/bin/env node
// Generated by ai-factory. PreToolUse guard: blocks edits/writes to paths the
// manifest marks forbidden (CLAUDE.md -> "All agents must NOT edit").
// Do not hand-edit — edit .factory.yaml's \`forbidden:\` list and re-run \`factory install\`.
import { readFileSync } from "node:fs";

const FORBIDDEN = ${list};

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // **/ matches zero or more leading dirs
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^\${}()|[]\\\\".includes(c)) {
      re += "\\\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

const matchers = FORBIDDEN.map(globToRegExp);

let raw = "";
try { raw = readFileSync(0, "utf8"); } catch {}
let data = {};
try { data = JSON.parse(raw || "{}"); } catch {}

const ti = data.tool_input || {};
const filePath = ti.file_path || ti.notebook_path || ti.path || "";
if (!filePath) process.exit(0);

const cwd = data.cwd || process.cwd();
let rel = filePath;
if (rel.startsWith(cwd)) rel = rel.slice(cwd.length);
rel = rel.replace(/^[/\\\\]+/, "");
const base = rel.split(/[/\\\\]/).pop() || rel;

for (let i = 0; i < matchers.length; i++) {
  if (matchers[i].test(rel) || matchers[i].test(base)) {
    console.error(
      'Blocked by ai-factory path guard: "' + rel + '" matches forbidden pattern "' + FORBIDDEN[i] +
      '" (CLAUDE.md -> "All agents must NOT edit"). If this edit is intentional, remove the pattern from .factory.yaml and re-run factory install.'
    );
    process.exit(2);
  }
}
process.exit(0);
`;
}
