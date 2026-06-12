import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { input, select, checkbox, confirm } from "@inquirer/prompts";
import { stringify as yamlStringify } from "yaml";
import type { Layer, Platform } from "../manifest.js";
import { parseProfileDefaults } from "../util/profile-defaults.js";
import { detectStack } from "../util/detect-stack.js";
import { allPlatforms, getAdapter } from "../platforms/index.js";

export interface InitOptions {
  targetRoot: string;
  factoryRoot: string;
  force: boolean;
}

const LAYER_CHOICES: { value: Layer; name: string }[] = [
  { value: "backend", name: "backend — API, services, jobs, data layer" },
  { value: "frontend", name: "frontend — UI components, pages, hooks" },
  { value: "fullstack", name: "fullstack — both backend and frontend in one repo" },
  { value: "worker", name: "worker — background jobs / queue consumer only" },
  { value: "mobile", name: "mobile — mobile app (React Native, Flutter, etc.)" },
];

// Stub adapters; surface them but mark disabled so users don't pick them by accident
const STUB_PLATFORMS: ReadonlySet<Platform> = new Set(["cursor", "windsurf"]);

export async function init(opts: InitOptions): Promise<void> {
  const targetRoot = resolve(opts.targetRoot);
  const manifestPath = join(targetRoot, ".factory.yaml");

  if (existsSync(manifestPath) && !opts.force) {
    console.error(`Refusing to overwrite ${manifestPath}. Pass --force to override.`);
    process.exit(1);
  }

  console.log(`Initializing .factory.yaml in ${targetRoot}\n`);

  const detected = detectStack(targetRoot);
  if (detected.profile) {
    console.log(`Detected: ${detected.reason} → suggesting profile "${detected.profile}", layer "${detected.layer}"\n`);
  }

  // 1. Name
  const name = await input({
    message: "Repo name (used as identifier in manifests):",
    default: basename(targetRoot),
  });

  // 2. Layer
  const layer = (await select({
    message: "Layer (what does this repo contain?):",
    choices: LAYER_CHOICES,
    default: detected.layer ?? "backend",
  })) as Layer;

  // 3. Profile
  const availableProfiles = listProfiles(opts.factoryRoot);
  if (availableProfiles.length === 0) {
    console.error(`No profiles found in ${opts.factoryRoot}/profiles/. Cannot continue.`);
    process.exit(1);
  }
  const profile = await select({
    message: "Stack profile (rules + defaults pack):",
    choices: availableProfiles.map((p) => ({ value: p, name: p })),
    default: detected.profile && availableProfiles.includes(detected.profile)
      ? detected.profile
      : availableProfiles[0]!,
  });

  // 4. Load profile defaults
  const profileBody = readFileSync(join(opts.factoryRoot, "profiles", `${profile}.md`), "utf8");
  const defaults = parseProfileDefaults(profileBody);
  const cmdDefaults = defaults.commands ?? {};
  const pathDefaults = defaults.paths ?? {};

  console.log("\nValidation commands (agents will run these — must be runnable verbatim):\n");

  const typecheck = await input({
    message: "Typecheck command:",
    default: cmdDefaults.typecheck ?? "npm run typecheck",
  });
  const lint = await input({
    message: "Lint command:",
    default: cmdDefaults.lint ?? "npm run lint",
  });
  const test = await input({
    message: "Unit-test command:",
    default: cmdDefaults.test ?? "npm test",
  });
  const acceptance = await input({
    message: "Acceptance/integration test command (leave blank to skip):",
    default: cmdDefaults.acceptance ?? "",
  });

  // 5. Platforms
  const platforms = (await checkbox({
    message: "AI platforms to generate files for (space to toggle):",
    choices: allPlatforms.map((p) => {
      const stub = STUB_PLATFORMS.has(p);
      return {
        value: p,
        name: stub ? `${p} (stub — not wired yet)` : p,
        checked: p === "claude-code",
        disabled: stub ? "stub adapter — coming in a later phase" : false,
      };
    }),
  })) as Platform[];

  if (platforms.length === 0) {
    console.error("At least one platform is required.");
    process.exit(1);
  }

  // Validate every chosen adapter exists (defensive — checkbox already filters stubs)
  for (const p of platforms) {
    try {
      getAdapter(p);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Adapter for "${p}" not available: ${msg}`);
      process.exit(1);
    }
  }

  // 6. Contracts repo (optional)
  const useContracts = await confirm({
    message: "Configure a contracts repo for cross-repo features? (can be added later)",
    default: false,
  });
  let contractsRepo: string | undefined;
  if (useContracts) {
    contractsRepo = await input({
      message: "Path or URL to contracts repo:",
      default: "../ai-factory-contracts",
    });
  }

  // 7. Compose the manifest
  // Note: `factory-repo` is intentionally NOT written. The global `factory`
  // binary already knows where its checkout lives; baking a developer-specific
  // local path into a team-shared manifest causes portability headaches.
  const manifest = composeManifest({
    name,
    layer,
    profile,
    factoryRoot: undefined,
    contractsRepo,
    commands: { typecheck, lint, test, acceptance: acceptance || undefined },
    paths: pathDefaults,
    platforms,
  });

  const yaml = yamlStringify(manifest, { lineWidth: 0 });
  console.log("\n--- .factory.yaml preview ---\n");
  console.log(yaml);
  console.log("------------------------------\n");

  const writeIt = await confirm({
    message: `Write to ${manifestPath}?`,
    default: true,
  });

  if (!writeIt) {
    console.log("Cancelled. Nothing written.");
    return;
  }

  writeFileSync(manifestPath, yaml);
  console.log(`\n✓ Wrote ${manifestPath}`);
  console.log("\nNext step: run `factory install` to generate platform files.\n");
  console.log("You can edit .factory.yaml at any time and re-run install. Path defaults");
  console.log("came from the profile — adjust them in the manifest if your repo differs.\n");
}

function listProfiles(factoryRoot: string): string[] {
  const dir = join(factoryRoot, "profiles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

interface ComposeArgs {
  name: string;
  layer: Layer;
  profile: string;
  /** Optional. Left undefined by default — see init's manifest-composition note. */
  factoryRoot: string | undefined;
  contractsRepo: string | undefined;
  commands: { typecheck: string; lint: string; test: string; acceptance?: string };
  paths: NonNullable<ReturnType<typeof parseProfileDefaults>["paths"]>;
  platforms: Platform[];
}

function composeManifest(args: ComposeArgs): Record<string, unknown> {
  const manifest: Record<string, unknown> = {
    name: args.name,
    layer: args.layer,
    profile: args.profile,
  };
  if (args.factoryRoot) manifest["factory-repo"] = args.factoryRoot;
  if (args.contractsRepo) manifest["contracts-repo"] = args.contractsRepo;

  const commands: Record<string, string> = {
    typecheck: args.commands.typecheck,
    lint: args.commands.lint,
    test: args.commands.test,
  };
  if (args.commands.acceptance) commands.acceptance = args.commands.acceptance;
  manifest.commands = commands;

  // Only include path keys with non-empty values; profile defaults define the bones
  const paths: Record<string, string[]> = {};
  for (const key of ["backend", "frontend", "shared", "tests", "forbidden", "migrations", "infra", "docs"] as const) {
    const v = args.paths[key];
    if (v && v.length > 0) paths[key] = v;
  }
  manifest.paths = paths;

  manifest.platforms = args.platforms;

  return manifest;
}
