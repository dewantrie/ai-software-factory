import type { PlatformAdapter } from "./index.js";

/**
 * Windsurf adapter — STUB.
 * Target structure for a Windsurf repo:
 *   .windsurf/rules/project.md      (project context, auto-loaded)
 *   .windsurf/rules/<agent>.md      (agent role definitions, manual activation)
 *   .windsurf/workflows/<skill>.md  (skill orchestrators — workflow files)
 *
 * Limitations:
 *   - Workflows can chain steps but no native multi-agent split
 *   - Tool scoping is prompt-only
 */
export const windsurf: PlatformAdapter = {
  name: "windsurf",
  contextFileName: ".windsurf/rules/project.md",

  async generate(_args) {
    throw new Error(
      "Windsurf adapter is a stub. Implementation pending. See src/platforms/windsurf.ts for the target structure.",
    );
  },
};
