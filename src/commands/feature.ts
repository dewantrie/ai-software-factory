import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { resolve, join, basename, dirname, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  resolveContractsRepo,
  featureDir,
  loadStatus,
  saveStatus,
  statusPath,
  listFeatures,
  type FeatureStatus,
  type ShippedEntry,
} from "../util/contracts.js";
import type { Layer } from "../manifest.js";

export interface FeatureCommonOptions {
  contractsRepo?: string;
  cwd: string;
}

/* ----- start ----- */

export interface FeatureStartOptions extends FeatureCommonOptions {
  /** Optional path to a markdown file to seed story.md (PM-authored externally). */
  from?: string;
}

export async function featureStart(
  name: string,
  opts: FeatureStartOptions,
): Promise<void> {
  const contractsRepo = resolveContractsRepo({ explicit: opts.contractsRepo, cwd: opts.cwd });
  const dir = featureDir(contractsRepo, name);

  if (existsSync(dir)) {
    throw new Error(`Feature already exists: ${dir}`);
  }

  // Resolve --from BEFORE creating the dir, so a missing file doesn't leave a half-created feature
  let storyBody: string;
  let storySource: "template" | string;
  if (opts.from) {
    const fromPath = resolve(opts.cwd, opts.from);
    if (!existsSync(fromPath)) {
      throw new Error(`--from file not found: ${fromPath}`);
    }
    storyBody = readFileSync(fromPath, "utf8");
    storySource = fromPath;
    warnIfStoryMissingSections(storyBody);
  } else {
    storyBody = storyTemplate(name);
    storySource = "template";
  }

  mkdirSync(dir, { recursive: true });

  const storyPath = join(dir, "story.md");
  writeFileSync(storyPath, storyBody);

  const status: FeatureStatus = {
    feature: name,
    created: new Date().toISOString(),
    shipped: [],
  };
  saveStatus(contractsRepo, status);

  console.log(`Created feature scaffold: ${dir}`);
  if (storySource !== "template") {
    console.log(`Seeded story.md from: ${storySource}`);
  }
  console.log("");
  console.log("Next steps:");
  if (storySource === "template") {
    console.log(`  1. Edit ${storyPath} with the user story + acceptance criteria.`);
    console.log(`  2. Commit the contracts repo (so other repos can pull it).`);
    console.log(`  3. In each implementing repo, run: factory feature pull ${name}`);
  } else {
    console.log(`  1. Review ${storyPath} — the PM's story is in place; tweak if needed.`);
    console.log(`  2. Commit the contracts repo (so other repos can pull it).`);
    console.log(`  3. In each implementing repo, run: factory feature pull ${name}`);
  }
}

function warnIfStoryMissingSections(body: string): void {
  const required = [
    { name: "User Story", pattern: /^#{1,3}\s*User Story/im },
    { name: "Acceptance Criteria", pattern: /^#{1,3}\s*Acceptance Criteria/im },
  ];
  const missing = required.filter((s) => !s.pattern.test(body)).map((s) => s.name);
  if (missing.length > 0) {
    console.warn(`⚠ Imported story is missing these sections: ${missing.join(", ")}`);
    console.warn("  The chain's spec-writer will stop and ask if they're truly absent.");
    console.warn("  Edit story.md to add them, OR proceed and let the chain flag it.");
  }
}

/* ----- pull ----- */

export async function featurePull(
  name: string,
  opts: FeatureCommonOptions,
): Promise<void> {
  const contractsRepo = resolveContractsRepo({ explicit: opts.contractsRepo, cwd: opts.cwd });
  const srcDir = featureDir(contractsRepo, name);

  if (!existsSync(srcDir)) {
    throw new Error(`Feature not found in contracts: ${srcDir}. Has \`factory feature start ${name}\` been run?`);
  }

  const destDir = join(resolve(opts.cwd), ".factory", "features", name);
  mkdirSync(destDir, { recursive: true });

  const copied: string[] = [];
  for (const file of readdirSync(srcDir)) {
    if (file === "status.yaml") continue;
    const src = join(srcDir, file);
    const dest = join(destDir, file);
    copyFileSync(src, dest);
    copied.push(file);
  }

  console.log(`Pulled feature "${name}" → ${destDir}`);
  if (copied.length === 0) {
    console.log("  (no artifacts in the contracts repo yet — story.md may be empty or not committed)");
  } else {
    for (const f of copied) console.log(`  + ${f}`);
  }
}

/* ----- ship ----- */

export interface FeatureShipOptions extends FeatureCommonOptions {
  /** Local path to the contract artifact to copy (e.g. docs/api/<feature>.openapi.yaml). */
  contract?: string;
  /** Layer of THIS repo (auto-detected from manifest if not given). */
  layer?: Layer;
  /** Name of THIS repo (auto-detected from manifest if not given). */
  repoName?: string;
  /** Optional commit SHA to record. */
  commit?: string;
}

export async function featureShip(name: string, opts: FeatureShipOptions): Promise<void> {
  const contractsRepo = resolveContractsRepo({ explicit: opts.contractsRepo, cwd: opts.cwd });
  const dir = featureDir(contractsRepo, name);

  if (!existsSync(dir)) {
    throw new Error(`Feature not found in contracts: ${dir}`);
  }

  // Determine this repo's identity (name + layer)
  const repoIdentity = readLocalRepoIdentity(opts.cwd, opts.repoName, opts.layer);

  // Copy contract if provided
  if (opts.contract) {
    const src = resolve(opts.cwd, opts.contract);
    if (!existsSync(src)) {
      throw new Error(`Contract file not found: ${src}`);
    }
    const ext = extname(src) || ".txt";
    const destName = `api${ext}`;
    const dest = join(dir, destName);
    copyFileSync(src, dest);
    console.log(`Copied contract: ${src} → ${dest}`);
  }

  // Update status.yaml
  const status = loadStatus(contractsRepo, name);
  const existing = status.shipped.findIndex((s) => s.name === repoIdentity.name);
  const entry: ShippedEntry = {
    name: repoIdentity.name,
    layer: repoIdentity.layer,
    shipped_at: new Date().toISOString(),
    ...(opts.commit ? { commit: opts.commit } : {}),
  };
  if (existing >= 0) {
    status.shipped[existing] = entry;
    console.log(`Updated status for ${repoIdentity.name} (re-ship)`);
  } else {
    status.shipped.push(entry);
    console.log(`Added ${repoIdentity.name} to status.shipped`);
  }
  saveStatus(contractsRepo, status);

  console.log("");
  console.log(`Done. Don't forget to commit + push the contracts repo.`);
  console.log(`Status file: ${statusPath(contractsRepo, name)}`);
}

/* ----- list ----- */

export async function featureList(opts: FeatureCommonOptions): Promise<void> {
  const contractsRepo = resolveContractsRepo({ explicit: opts.contractsRepo, cwd: opts.cwd });
  const features = listFeatures(contractsRepo);

  if (features.length === 0) {
    console.log(`No features in ${join(contractsRepo, "features")}/`);
    return;
  }

  console.log(`Features in ${contractsRepo}:`);
  for (const name of features) {
    let shippedCount = 0;
    try {
      const status = loadStatus(contractsRepo, name);
      shippedCount = status.shipped.length;
    } catch {
      // ignore unreadable status; list the feature anyway
    }
    console.log(`  - ${name}  (shipped in ${shippedCount} repo${shippedCount === 1 ? "" : "s"})`);
  }
}

/* ----- status ----- */

export async function featureStatus(name: string, opts: FeatureCommonOptions): Promise<void> {
  const contractsRepo = resolveContractsRepo({ explicit: opts.contractsRepo, cwd: opts.cwd });
  const status = loadStatus(contractsRepo, name);

  console.log(`Feature:   ${status.feature}`);
  console.log(`Created:   ${status.created}`);
  console.log(`Shipped in ${status.shipped.length} repo${status.shipped.length === 1 ? "" : "s"}:`);
  if (status.shipped.length === 0) {
    console.log("  (none yet)");
    return;
  }
  for (const s of status.shipped) {
    const commitPart = s.commit ? ` @${s.commit}` : "";
    console.log(`  - ${s.name} (${s.layer}) — shipped ${s.shipped_at}${commitPart}`);
  }
}

/* ----- helpers ----- */

function storyTemplate(name: string): string {
  return `# Story: ${name}

Authored once; shared across every repo that implements this feature.

## User Story

\`\`\`
As a [role]
I want [observable behavior]
So that [outcome]
\`\`\`

## Acceptance Criteria

1.
2.
3.

## Edge Cases

-

## Out of Scope

-

## Open Questions

-
`;
}

interface RepoIdentity {
  name: string;
  layer: Layer;
}

function readLocalRepoIdentity(cwd: string, nameOverride: string | undefined, layerOverride: Layer | undefined): RepoIdentity {
  if (nameOverride && layerOverride) {
    return { name: nameOverride, layer: layerOverride };
  }

  const manifestPath = resolve(cwd, ".factory.yaml");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `No .factory.yaml in ${cwd}. Pass --repo-name and --layer explicitly, or run from a managed repo.`,
    );
  }

  const parsed = parseYaml(readFileSync(manifestPath, "utf8")) as { name?: string; layer?: Layer };
  return {
    name: nameOverride ?? parsed.name ?? basename(dirname(manifestPath)),
    layer: layerOverride ?? parsed.layer ?? ("backend" as Layer),
  };
}
