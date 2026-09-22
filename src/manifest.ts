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
  /**
   * Optional per-agent model override, keyed by agent name (`story-writer`,
   * `backend-builder`, …). Values are whatever the target platform accepts —
   * an alias such as `sonnet`, `opus`, `haiku` or `inherit`, or a full model ID.
   * An agent with no entry gets no `model` key at all and follows the session
   * default, so omitting this changes nothing.
   */
  models?: Record<string, string>;
  /**
   * Optional lifecycle hooks, off by default. Both change how a session
   * behaves, so they are opt-in rather than imposed on every repo.
   */
  hooks?: HookOptions;
  platforms: Platform[];
  notes?: string;
}

export interface HookOptions {
  /**
   * Stop hook: refuse to end a turn while `commands.typecheck` / `commands.test`
   * fail and the working tree is dirty. Reports once per distinct tree state.
   */
  stopOnFailingValidation?: boolean;
  /** SubagentStop hook: record each agent's final output to `.factory/runs/`. */
  captureAgentOutput?: boolean;
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

  const models = m.models;
  if (models !== undefined) {
    if (typeof models !== "object" || models === null || Array.isArray(models)) {
      throw new Error(`Manifest ${path}: models must be a map of agent name to model.`);
    }
    for (const [agent, value] of Object.entries(models as Record<string, unknown>)) {
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Manifest ${path}: models.${agent} must be a non-empty string.`);
      }
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

function normalizeHooks(raw: unknown): HookOptions | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const h = raw as Record<string, unknown>;
  const opts: HookOptions = {};
  if (h["stop-on-failing-validation"] === true) opts.stopOnFailingValidation = true;
  if (h["capture-agent-output"] === true) opts.captureAgentOutput = true;
  return Object.keys(opts).length > 0 ? opts : undefined;
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
    models: m.models as Record<string, string> | undefined,
    hooks: normalizeHooks(m.hooks),
    platforms: m.platforms as Platform[],
    notes: m.notes as string | undefined,
  };
}
