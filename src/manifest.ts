import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

export type Layer = "backend" | "frontend" | "worker" | "mobile" | "fullstack";
export type Platform = "claude-code" | "kiro" | "codex";

export interface Commands {
  typecheck: string;
  lint: string;
  test: string;
  acceptance?: string;
}

export interface Paths {
  backend?: string[];
  frontend?: string[];
  shared?: string[];
  forbidden?: string[];
  tests?: string[];
  migrations?: string[];
  infra?: string[];
  docs?: string[];
}

export interface Manifest {
  name: string;
  layer: Layer;
  profile: string;
  factoryRepo?: string;
  contractsRepo?: string;
  commands: Commands;
  paths: Paths;
  dontDo?: string[];
  platforms: Platform[];
  notes?: string;
}

export function loadManifest(path = ".factory.yaml"): Manifest {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    throw new Error(`Manifest not found: ${abs}`);
  }
  const raw = readFileSync(abs, "utf8");
  const parsed = parse(raw) as Record<string, unknown>;
  validateManifest(parsed, abs);
  return normalizeManifest(parsed);
}

function validateManifest(m: Record<string, unknown>, path: string): void {
  const required = ["name", "layer", "profile", "commands", "paths", "platforms"];
  for (const key of required) {
    if (!(key in m)) {
      throw new Error(`Manifest ${path} missing required field: ${key}`);
    }
  }
  const validLayers: Layer[] = ["backend", "frontend", "worker", "mobile", "fullstack"];
  if (!validLayers.includes(m.layer as Layer)) {
    throw new Error(`Manifest ${path}: invalid layer "${m.layer}". Must be one of: ${validLayers.join(", ")}`);
  }

  const commands = m.commands as Record<string, unknown> | null | undefined;
  for (const cmd of ["typecheck", "lint", "test"] as const) {
    const v = commands?.[cmd];
    if (typeof v !== "string" || v.trim() === "") {
      throw new Error(`Manifest ${path}: commands.${cmd} must be a non-empty string.`);
    }
  }

  const validPlatforms: Platform[] = ["claude-code", "kiro", "codex"];
  const platforms = m.platforms;
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error(`Manifest ${path}: platforms must be a non-empty list.`);
  }
  for (const p of platforms) {
    if (!validPlatforms.includes(p as Platform)) {
      throw new Error(`Manifest ${path}: invalid platform "${p}". Must be one of: ${validPlatforms.join(", ")}`);
    }
  }
}

function normalizeManifest(m: Record<string, unknown>): Manifest {
  return {
    name: m.name as string,
    layer: m.layer as Layer,
    profile: m.profile as string,
    factoryRepo: m["factory-repo"] as string | undefined,
    contractsRepo: m["contracts-repo"] as string | undefined,
    commands: m.commands as Commands,
    paths: (m.paths ?? {}) as Paths,
    dontDo: (m["dont-do"] as string[]) ?? [],
    platforms: m.platforms as Platform[],
    notes: m.notes as string | undefined,
  };
}
