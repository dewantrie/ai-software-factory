import type { PlatformAdapter } from "./index.js";

/**
 * Kiro adapter — STUB.
 * Target structure for a Kiro repo:
 *   .kiro/steering/<name>.md  (frontmatter: inclusion: always | fileMatch | manual)
 *   .kiro/agents/<name>.md    (Kiro agent definitions)
 *   .kiro/specs/              (per-feature spec workflow folders)
 *
 * Mapping notes:
 *   - Context doc → split into multiple steering files with `inclusion: always`
 *   - Agent prompts → .kiro/agents/<name>.md or steering with `inclusion: manual`
 *   - Skill orchestrators → spec templates + agent chat
 *   - Story/Spec docs map naturally to Kiro's requirements.md / design.md / tasks.md
 */
export const kiro: PlatformAdapter = {
  name: "kiro",
  contextFileName: ".kiro/steering/project.md",

  async generate(_args) {
    throw new Error(
      "Kiro adapter is a stub. Implementation pending. See src/platforms/kiro.ts for the target structure.",
    );
  },
};
