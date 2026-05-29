import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { loadWorkspace } from "../util/workspace.js";
import { install } from "./install.js";

export interface SyncOptions {
  workspacePath?: string;
  factoryRoot: string;
  dryRun: boolean;
}

type RepoStatus = "ok" | "skipped" | "failed";

interface RepoResult {
  repo: string;
  status: RepoStatus;
  reason?: string;
}

export async function sync(opts: SyncOptions): Promise<void> {
  const workspace = loadWorkspace(opts.workspacePath, opts.factoryRoot);
  const workspaceDir = dirname(workspace.path);

  console.log(`Workspace: ${workspace.path}`);
  console.log(`Factory root: ${opts.factoryRoot}`);
  console.log(`Repos: ${workspace.repos.length}${opts.dryRun ? " (dry run)" : ""}`);
  console.log("");

  const results: RepoResult[] = [];

  for (const repoEntry of workspace.repos) {
    const abs = resolve(workspaceDir, repoEntry);
    console.log(`→ ${abs}`);

    if (!existsSync(abs)) {
      console.log(`  ✗ directory not found`);
      results.push({ repo: abs, status: "failed", reason: "directory not found" });
      console.log("");
      continue;
    }

    const manifestPath = join(abs, ".factory.yaml");
    if (!existsSync(manifestPath)) {
      console.log(`  ⚠ no .factory.yaml — run \`factory init\` here first`);
      results.push({ repo: abs, status: "skipped", reason: "no manifest" });
      console.log("");
      continue;
    }

    if (opts.dryRun) {
      console.log(`  (dry-run; would run install)`);
      results.push({ repo: abs, status: "ok" });
      console.log("");
      continue;
    }

    try {
      await install({
        manifestPath: ".factory.yaml",
        factoryRoot: opts.factoryRoot,
        targetRoot: abs,
      });
      results.push({ repo: abs, status: "ok" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ install failed: ${msg}`);
      results.push({ repo: abs, status: "failed", reason: msg });
    }

    console.log("");
  }

  // Summary
  const ok = results.filter((r) => r.status === "ok").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  console.log("===== Summary =====");
  console.log(`  ✓ synced:  ${ok}`);
  if (skipped > 0) console.log(`  ⚠ skipped: ${skipped}`);
  if (failed > 0) console.log(`  ✗ failed:  ${failed}`);

  if (failed > 0) {
    console.log("");
    console.log("Failed repos:");
    for (const r of results.filter((r) => r.status === "failed")) {
      console.log(`  - ${r.repo}: ${r.reason}`);
    }
    process.exit(1);
  }
}
