import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";
import type { Layer } from "../manifest.js";

export interface ShippedEntry {
  name: string;
  layer: Layer;
  shipped_at: string;
  commit?: string;
}

export interface FeatureStatus {
  feature: string;
  created: string;
  shipped: ShippedEntry[];
}

/**
 * Resolve the contracts repo path.
 * Order: explicit flag → `contracts-repo` in the local manifest → throws.
 *
 * The manifest's `contracts-repo` is resolved relative to the manifest's directory.
 */
export function resolveContractsRepo(opts: {
  explicit?: string;
  cwd: string;
}): string {
  if (opts.explicit) return resolve(opts.cwd, opts.explicit);

  const manifestPath = resolve(opts.cwd, ".factory.yaml");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No .factory.yaml found in ${opts.cwd}. Either pass --contracts-repo <path> or run from a repo with a manifest.`,
    );
  }

  const manifest = parseYaml(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const contractsRepo = manifest["contracts-repo"];
  if (typeof contractsRepo !== "string" || contractsRepo.length === 0) {
    throw new Error(
      `Manifest at ${manifestPath} has no \`contracts-repo\` field. Add one or pass --contracts-repo <path>.`,
    );
  }

  return resolve(dirname(manifestPath), contractsRepo);
}

export function featureDir(contractsRepo: string, name: string): string {
  return join(contractsRepo, "features", name);
}

export function statusPath(contractsRepo: string, name: string): string {
  return join(featureDir(contractsRepo, name), "status.yaml");
}

export function loadStatus(contractsRepo: string, name: string): FeatureStatus {
  const p = statusPath(contractsRepo, name);
  if (!existsSync(p)) {
    throw new Error(`Status file not found: ${p}. Has \`factory feature start ${name}\` been run?`);
  }
  const parsed = parseYaml(readFileSync(p, "utf8")) as FeatureStatus;
  if (!parsed || !Array.isArray(parsed.shipped)) {
    throw new Error(`Malformed status.yaml at ${p}`);
  }
  return parsed;
}

export function saveStatus(contractsRepo: string, status: FeatureStatus): void {
  const p = statusPath(contractsRepo, status.feature);
  writeFileSync(p, yamlStringify(status, { lineWidth: 0 }));
}

export function listFeatures(contractsRepo: string): string[] {
  const dir = join(contractsRepo, "features");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => {
      const sub = join(dir, name);
      try {
        return statSync(sub).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}
