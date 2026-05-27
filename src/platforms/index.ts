import type { Manifest, Platform } from "../manifest.js";
import type { PromptFile } from "../render.js";

export interface PlatformWriteResult {
  filesWritten: string[];
  filesSkipped: string[];
}

export interface PlatformAdapter {
  name: Platform;
  contextFileName: string;
  /**
   * Generate platform-specific files for this repo.
   * @param targetRoot - absolute path to the project repo root
   * @param ctx - rendering context
   */
  generate(args: {
    targetRoot: string;
    manifest: Manifest;
    agents: PromptFile[];
    skills: PromptFile[];
    profileBody: string;
  }): Promise<PlatformWriteResult>;
}

import { claudeCode } from "./claude-code.js";
import { kiro } from "./kiro.js";
import { cursor } from "./cursor.js";
import { codex } from "./codex.js";
import { windsurf } from "./windsurf.js";

const registry: Record<Platform, PlatformAdapter> = {
  "claude-code": claudeCode,
  kiro,
  cursor,
  codex,
  windsurf,
};

export function getAdapter(platform: Platform): PlatformAdapter {
  const adapter = registry[platform];
  if (!adapter) {
    throw new Error(`Unknown platform: ${platform}`);
  }
  return adapter;
}

export const allPlatforms = Object.keys(registry) as Platform[];
