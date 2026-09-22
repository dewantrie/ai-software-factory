import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "../manifest.js";
import type { PlatformAdapter } from "./index.js";
import { buildContextFile, render } from "../render.js";
import { ALLOW_KEY_BY_AGENT, agentAllowMap, scopeConfig } from "../util/scope.js";
import { DESCRIPTIONS_BY_AGENT } from "../util/agent-meta.js";

// Source-of-truth guard script. It's a real, directly-testable .mjs file (see
// test/factory-guard.test.ts) copied verbatim into each repo's .claude/hooks/ —
// not a generated template string. Resolved relative to this module so it works
// under tsx-on-src and a dist build alike (../../assets from src|dist /platforms/).
const GUARD_ASSET_PATH = fileURLToPath(new URL("../../assets/factory-guard.mjs", import.meta.url));

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
        // Only when the manifest names one — an absent key means "inherit the
        // session default", which is the behaviour repos already have.
        ...(manifest.models?.[agent.name] ? [`model: ${manifest.models[agent.name]}`] : []),
        ...agentHooksBlock(agent.name, manifest),
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

    // 4. Path guard — enforces forbidden (session-wide) and per-agent allow-lists
    //    at the tool level. Frontmatter can't scope paths, so a PreToolUse hook does.
    writeScopeGuard(targetRoot, manifest, filesWritten);

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

/* ------- Path guard (PreToolUse hooks) ------- */

const GUARD_REL_PATH = ".claude/hooks/factory-guard.mjs";
const SCOPE_CONFIG_REL_PATH = ".claude/hooks/factory-scope.json";
const SETTINGS_REL_PATH = ".claude/settings.json";
const GUARD_MARKER = "factory-guard.mjs";

const STOP_REL_PATH = ".claude/hooks/factory-stop.mjs";
const STOP_CONFIG_REL_PATH = ".claude/hooks/factory-stop.json";
const CAPTURE_REL_PATH = ".claude/hooks/factory-capture.mjs";
const STOP_MARKER = "factory-stop.mjs";
const CAPTURE_MARKER = "factory-capture.mjs";

const STOP_ASSET_PATH = fileURLToPath(new URL("../../assets/factory-stop.mjs", import.meta.url));
const CAPTURE_ASSET_PATH = fileURLToPath(new URL("../../assets/factory-capture.mjs", import.meta.url));

/** Frontmatter `hooks:` lines for an editing agent whose allow-list is present; [] otherwise. */
function agentHooksBlock(agentName: string, manifest: Manifest): string[] {
  const key = ALLOW_KEY_BY_AGENT[agentName];
  if (!key || manifest.paths[key] === undefined) return [];
  return [
    "hooks:",
    "  PreToolUse:",
    '    - matcher: "Write|Edit|MultiEdit|NotebookEdit"',
    "      hooks:",
    "        - type: command",
    `          command: 'node "$CLAUDE_PROJECT_DIR/${GUARD_REL_PATH}" ${agentName}'`,
  ];
}

/**
 * A forbidden glob expressed as a Claude Code permission rule.
 *
 * `Edit(...)`, never `Write(...)`: Claude Code consults file-path rules for
 * `Read` and `Edit` only. A path rule on `Write`, `NotebookEdit` or `MultiEdit`
 * is accepted, never checked, and warns at startup. `Edit` covers the built-in
 * edit tools *and* the file commands Claude Code recognises inside Bash — `tee`,
 * `sed`, and `> file` redirects — which is precisely the vector the PreToolUse
 * hook cannot see, since that hook only fires on the edit tools.
 *
 * Deliberately no matching `Read(...)` rule: the manifest declares these paths
 * as "no agent may edit", not "may not read", and a pattern like `.env*` would
 * otherwise also blind every agent to `.env.example`.
 *
 * No translation is needed — `forbidden:` globs and Claude Code path rules both
 * use gitignore semantics, where a bare filename matches at any depth.
 */
function denyRule(glob: string): string {
  return `Edit(${glob})`;
}

/**
 * Write (or remove) the scope guard. Emits the script + config when there is
 * anything to enforce (forbidden non-empty OR any agent allow-list present).
 * The session-level settings.json hook and the `permissions.deny` rules are
 * added only when forbidden is non-empty; allow-lists are wired per-agent,
 * not at session level.
 */
function writeScopeGuard(targetRoot: string, manifest: Manifest, filesWritten: string[]): void {
  const config = scopeConfig(manifest);
  const hasForbidden = config.forbidden.length > 0;
  const hasAgents = Object.keys(config.agents).length > 0;

  const settingsPath = join(targetRoot, SETTINGS_REL_PATH);
  const scriptPath = join(targetRoot, GUARD_REL_PATH);
  const configPath = join(targetRoot, SCOPE_CONFIG_REL_PATH);

  // Read before overwriting. The previous forbidden list is the only record of
  // which deny rules this tool owns, so pruning against it lets a shrunk or
  // renamed list clean up after itself without touching the user's own rules.
  const prevForbidden = previousForbidden(configPath);

  if (!hasForbidden && !hasAgents) {
    if (removeIfExists(configPath)) filesWritten.push(configPath);
    if (removeIfExists(scriptPath)) filesWritten.push(scriptPath);
    if (
      updateSettings(settingsPath, {
        hook: false,
        forbidden: [],
        prevForbidden,
        ...lifecycle(targetRoot, manifest, filesWritten),
      })
    ) {
      filesWritten.push(settingsPath);
    }
    return;
  }

  writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  filesWritten.push(configPath);
  mkdirSync(dirname(scriptPath), { recursive: true });
  copyFileSync(GUARD_ASSET_PATH, scriptPath);
  filesWritten.push(scriptPath);

  if (
    updateSettings(settingsPath, {
      hook: hasForbidden,
      forbidden: config.forbidden,
      prevForbidden,
      ...lifecycle(targetRoot, manifest, filesWritten),
    })
  ) {
    filesWritten.push(settingsPath);
  }
}

/**
 * Write (or remove) the opt-in lifecycle hook scripts, and report which ones
 * settings.json should now reference. Both are off unless `.factory.yaml` asks
 * for them: each changes how a session behaves, which isn't a change to make on
 * a repo's behalf.
 */
function lifecycle(
  targetRoot: string,
  manifest: Manifest,
  filesWritten: string[],
): { stop: boolean; capture: boolean } {
  const stop = manifest.hooks?.stopOnFailingValidation === true;
  const capture = manifest.hooks?.captureAgentOutput === true;

  const stopScript = join(targetRoot, STOP_REL_PATH);
  const stopConfig = join(targetRoot, STOP_CONFIG_REL_PATH);
  const captureScript = join(targetRoot, CAPTURE_REL_PATH);

  if (stop) {
    // The hook re-runs the repo's own commands, so it needs them on disk —
    // it can't read .factory.yaml (that's the factory's format, not Claude's).
    const commands: Record<string, string> = { test: manifest.commands.test };
    if (manifest.commands.typecheck) commands.typecheck = manifest.commands.typecheck;
    writeFile(stopConfig, JSON.stringify(commands, null, 2) + "\n");
    filesWritten.push(stopConfig);
    mkdirSync(dirname(stopScript), { recursive: true });
    copyFileSync(STOP_ASSET_PATH, stopScript);
    filesWritten.push(stopScript);
  } else {
    if (removeIfExists(stopConfig)) filesWritten.push(stopConfig);
    if (removeIfExists(stopScript)) filesWritten.push(stopScript);
  }

  if (capture) {
    mkdirSync(dirname(captureScript), { recursive: true });
    copyFileSync(CAPTURE_ASSET_PATH, captureScript);
    filesWritten.push(captureScript);
  } else if (removeIfExists(captureScript)) {
    filesWritten.push(captureScript);
  }

  return { stop, capture };
}

/** The `forbidden` list recorded by the previous install, if any. */
function previousForbidden(configPath: string): string[] {
  if (!existsSync(configPath)) return [];
  try {
    const prev = JSON.parse(readFileSync(configPath, "utf8")) as { forbidden?: unknown };
    return Array.isArray(prev.forbidden) ? prev.forbidden.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

function removeIfExists(path: string): boolean {
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

interface HookCommand {
  type: string;
  command: string;
}
interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
}

/** A hook entry that runs one of our scripts, identified by the script name. */
function ownsMarker(entry: HookEntry, marker: string): boolean {
  return (entry.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(marker));
}

function hookEntry(relPath: string, matcher?: string): HookEntry {
  const command: HookCommand = { type: "command", command: `node "$CLAUDE_PROJECT_DIR/${relPath}"` };
  // `matcher` first, to keep the serialized key order every repo already has —
  // reordering it would churn settings.json in every consuming repo for nothing.
  return matcher ? { matcher, hooks: [command] } : { hooks: [command] };
}

/**
 * Set or clear one of our hooks on one event, leaving any hook we don't own in
 * place. Ownership is by script name, so a user's own entry on the same event
 * survives and ours never duplicates across re-installs.
 */
function applyHook(
  hooks: Record<string, HookEntry[]>,
  event: string,
  marker: string,
  entry: HookEntry | null,
): void {
  const current = Array.isArray(hooks[event]) ? hooks[event] : [];
  const others = current.filter((e) => !ownsMarker(e, marker));
  if (entry) others.push(entry);
  if (others.length > 0) hooks[event] = others;
  else delete hooks[event];
}

function readSettings(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface SettingsUpdate {
  /** Whether the session-wide PreToolUse guard hook should be present. */
  hook: boolean;
  /** Forbidden globs to express as `permissions.deny` rules. */
  forbidden: string[];
  /** Forbidden globs from the previous install, whose rules are pruned. */
  prevForbidden: string[];
  /** Whether the Stop validation gate should be wired up. */
  stop: boolean;
  /** Whether the SubagentStop output recorder should be wired up. */
  capture: boolean;
}

/**
 * Merge the factory's two settings contributions — the guard hook and the
 * `permissions.deny` rules — into `.claude/settings.json`, leaving everything
 * else in the file untouched. Returns true if the file was written.
 */
function updateSettings(settingsPath: string, update: SettingsUpdate): boolean {
  const existed = existsSync(settingsPath);
  const settings = readSettings(settingsPath);
  const before = JSON.stringify(settings);

  // --- our three hooks, each owned by the script name in its command ---
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  applyHook(
    hooks,
    "PreToolUse",
    GUARD_MARKER,
    update.hook ? hookEntry(GUARD_REL_PATH, "Write|Edit|MultiEdit|NotebookEdit") : null,
  );
  applyHook(hooks, "Stop", STOP_MARKER, update.stop ? hookEntry(STOP_REL_PATH) : null);
  applyHook(hooks, "SubagentStop", CAPTURE_MARKER, update.capture ? hookEntry(CAPTURE_REL_PATH) : null);
  if (Object.keys(hooks).length > 0) settings.hooks = hooks;
  else delete settings.hooks;

  // --- permissions.deny (ours = rules derived from this or the previous list) ---
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  const existingDeny = Array.isArray(permissions.deny)
    ? (permissions.deny as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  const ours = new Set([...update.prevForbidden, ...update.forbidden].map(denyRule));
  const nextDeny = [...existingDeny.filter((r) => !ours.has(r)), ...update.forbidden.map(denyRule)];
  if (nextDeny.length > 0) permissions.deny = nextDeny;
  else delete permissions.deny;
  if (Object.keys(permissions).length > 0) settings.permissions = permissions;
  else delete settings.permissions;

  const after = JSON.stringify(settings);
  if (after === before && (existed || after === "{}")) return false;
  writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}
