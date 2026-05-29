import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface Workspace {
  /** Absolute path of the workspace file that was loaded. */
  path: string;
  /** Repo paths as written; may be relative to the workspace file's directory. */
  repos: string[];
}

/**
 * Resolve a workspace file. Lookup order:
 *   1. explicit path (--workspace)
 *   2. ./factory.workspace.yaml in current working directory
 *   3. <factory-root>/workspace.yaml
 *
 * Throws if none of the candidates exist.
 */
export function loadWorkspace(explicitPath: string | undefined, factoryRoot: string): Workspace {
  const candidates: string[] = [];
  if (explicitPath) candidates.push(resolve(explicitPath));
  candidates.push(resolve(process.cwd(), "factory.workspace.yaml"));
  candidates.push(resolve(factoryRoot, "workspace.yaml"));

  for (const p of candidates) {
    if (existsSync(p)) return loadFromPath(p);
  }

  throw new Error(
    `No workspace file found. Tried:\n${candidates.map((c) => `  - ${c}`).join("\n")}\n\n` +
      `Create one with:\n  repos:\n    - ../my-repo-1\n    - ../my-repo-2\n`,
  );
}

function loadFromPath(path: string): Workspace {
  const body = readFileSync(path, "utf8");
  const parsed = parseYaml(body) as { repos?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.repos)) {
    throw new Error(`Workspace file ${path} must contain a top-level \`repos\` list.`);
  }

  const repos: string[] = [];
  for (const item of parsed.repos) {
    if (typeof item === "string") {
      repos.push(item);
    } else if (item && typeof item === "object" && "path" in item && typeof (item as Record<string, unknown>).path === "string") {
      repos.push((item as { path: string }).path);
    } else {
      throw new Error(`Invalid repo entry in ${path}: ${JSON.stringify(item)}`);
    }
  }

  return { path, repos };
}
