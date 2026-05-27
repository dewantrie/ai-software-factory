import type { PlatformAdapter } from "./index.js";

/**
 * Codex CLI adapter — STUB.
 * Target structure for a Codex-using repo:
 *   AGENTS.md                       (single root context doc — auto-loaded by Codex CLI)
 *   .codex/agents/<name>.md         (prompt files invoked via `codex --file`)
 *   .codex/orchestrator/*.sh        (shell scripts chaining codex calls with checkpoints)
 *
 * Mapping notes:
 *   - Context doc → AGENTS.md (single file at root)
 *   - Agent prompts → standalone prompt files; invoke separately per chain step
 *   - Skill orchestrators → bash scripts that read AGENTS.md, chain `codex --file <agent>` calls,
 *     prompt user for approval between steps via `read -p`
 *   - Tool scoping → use `--read` (readonly) vs default (writable) per invocation
 */
export const codex: PlatformAdapter = {
  name: "codex",
  contextFileName: "AGENTS.md",

  async generate(_args) {
    throw new Error(
      "Codex adapter is a stub. Implementation pending. See src/platforms/codex.ts for the target structure.",
    );
  },
};
