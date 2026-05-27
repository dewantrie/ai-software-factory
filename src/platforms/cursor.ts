import type { PlatformAdapter } from "./index.js";

/**
 * Cursor adapter — STUB.
 * Target structure for a Cursor repo:
 *   .cursor/rules/project.mdc       (alwaysApply: true — the context doc)
 *   .cursor/rules/agents/<name>.mdc (alwaysApply: false — manual or agent-requested)
 *   .cursor/notepads/<skill>.md     (skill orchestrators as reusable templates)
 *
 * Frontmatter format for .mdc files:
 *   ---
 *   description: ...
 *   globs: [...]            (optional, for auto-attach)
 *   alwaysApply: true|false
 *   ---
 *
 * Limitations:
 *   - No native subagent invocation — chain runs by manual @-mention
 *   - Tool scoping is prompt-only
 */
export const cursor: PlatformAdapter = {
  name: "cursor",
  contextFileName: ".cursor/rules/project.mdc",

  async generate(_args) {
    throw new Error(
      "Cursor adapter is a stub. Implementation pending. See src/platforms/cursor.ts for the target structure.",
    );
  },
};
