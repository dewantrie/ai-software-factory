import { resolve, isAbsolute, join } from "node:path";
import { loadManifest } from "../manifest.js";
import { loadPrompts, loadProfile } from "../render.js";
import { getAdapter } from "../platforms/index.js";

export interface InstallOptions {
  manifestPath: string;
  factoryRoot: string;
  targetRoot: string;
}

export async function install(opts: InstallOptions): Promise<void> {
  const resolvedTarget = resolve(opts.targetRoot);
  const resolvedManifestPath = isAbsolute(opts.manifestPath)
    ? opts.manifestPath
    : join(resolvedTarget, opts.manifestPath);
  const manifest = loadManifest(resolvedManifestPath);
  console.log(`Installing factory for ${manifest.name} (layer: ${manifest.layer})`);
  console.log(`Profile: ${manifest.profile}`);
  console.log(`Platforms: ${manifest.platforms.join(", ")}`);
  console.log("");

  const { agents, skills } = loadPrompts(opts.factoryRoot);
  const profileBody = loadProfile(opts.factoryRoot, manifest.profile);

  for (const platform of manifest.platforms) {
    try {
      const adapter = getAdapter(platform);
      console.log(`→ Generating ${platform} files...`);
      const result = await adapter.generate({
        targetRoot: resolvedTarget,
        manifest,
        agents,
        skills,
        profileBody,
      });
      console.log(`  ${result.filesWritten.length} file(s) written`);
      for (const f of result.filesWritten) {
        console.log(`    + ${f}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${platform} failed: ${message}`);
    }
  }
}
