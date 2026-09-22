import type { Manifest, Paths } from "../manifest.js";

/**
 * Editing agent -> the manifest path-list key it is allowed to edit. Read-only
 * agents are absent (they have no edit tools). `shared` is read-only context and
 * is intentionally not an allow-list.
 *
 * Shared by every platform adapter that enforces path scoping (claude-code,
 * codex) so the agent->key mapping can never drift between them.
 */
export const ALLOW_KEY_BY_AGENT: Record<string, keyof Paths> = {
  "backend-builder": "backend",
  "frontend-builder": "frontend",
  "test-verifier": "tests",
  "migration-author": "migrations",
  "devops-builder": "infra",
  "doc-writer": "docs",
};

export interface ScopeConfig {
  forbidden: string[];
  agents: Record<string, string[]>;
  /**
   * The platform's context file, quoted back in the guard's block message so it
   * points at a file that actually exists on that platform. The guard is shared
   * by Claude Code and Kiro, and used to hardcode "CLAUDE.md" — which sent Kiro
   * users to a file their repo doesn't have.
   */
  contextFile: string;
}

/** Agents whose allow-list is PRESENT in the manifest (empty list counts as present). */
export function agentAllowMap(manifest: Manifest): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [agent, key] of Object.entries(ALLOW_KEY_BY_AGENT)) {
    const list = manifest.paths[key];
    if (list !== undefined) map[agent] = list;
  }
  return map;
}

/** The data the generated guard/check scripts read from `factory-scope.json`. */
export function scopeConfig(manifest: Manifest, contextFile: string): ScopeConfig {
  return { forbidden: manifest.paths.forbidden ?? [], agents: agentAllowMap(manifest), contextFile };
}

/** True when there is anything to enforce (a forbidden list or any agent allow-list). */
export function hasScopeToEnforce(config: ScopeConfig): boolean {
  return config.forbidden.length > 0 || Object.keys(config.agents).length > 0;
}

/**
 * Whether this agent belongs in this repo at all.
 *
 * Read-only agents always do — researching or reviewing is useful anywhere.
 * An *editing* agent is only generated when the manifest declares the paths it
 * owns. A frontend-only repo has no business shipping a `migration-author` for
 * a database it doesn't have, and the cost isn't just noise: an editing agent
 * with no declared paths gets no allow-list, so the guard falls through to the
 * forbidden list alone and that agent can write **anywhere**. The unwanted
 * agent was the least constrained one in the repo.
 *
 * Note the distinction the manifest can still express, and which D6 depends on:
 * an absent key means "this agent does not exist here", while a key present but
 * empty (`frontend: []`) means "it exists and may edit nothing".
 */
export function isAgentRelevant(agentName: string, manifest: Manifest): boolean {
  const key = ALLOW_KEY_BY_AGENT[agentName];
  if (!key) return true; // read-only agent
  return manifest.paths[key] !== undefined;
}

/** The agents that belong in this repo, preserving input order. */
export function relevantAgents<T extends { name: string }>(agents: T[], manifest: Manifest): T[] {
  return agents.filter((a) => isAgentRelevant(a.name, manifest));
}
