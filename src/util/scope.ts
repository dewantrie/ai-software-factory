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
export function scopeConfig(manifest: Manifest): ScopeConfig {
  return { forbidden: manifest.paths.forbidden ?? [], agents: agentAllowMap(manifest) };
}

/** True when there is anything to enforce (a forbidden list or any agent allow-list). */
export function hasScopeToEnforce(config: ScopeConfig): boolean {
  return config.forbidden.length > 0 || Object.keys(config.agents).length > 0;
}
