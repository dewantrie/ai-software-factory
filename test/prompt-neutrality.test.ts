import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Prompts must stay platform-neutral (book ch. 01): the only platform seam is
// `{{CONTEXT_FILE}}`. Naming one platform's tools leaks into every other one —
// and it is not a harmless leak. `prompts/agents/researcher.md` once told the
// agent to "use Grep and Glob" and to "not run shell commands"; on Codex, which
// has no such tools and inspects the repo *through* the shell, that combination
// left the researcher unable to read anything. A real `spike.sh` run returned
// "unable to determine" for every section. Tool naming belongs in the adapters
// (TOOLS_BY_AGENT in claude-code.ts, the tools array in kiro.ts), never here.

const FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Tool names that exist on one platform only. */
const PLATFORM_TOOL_NAMES = ["Grep", "Glob", "MultiEdit", "NotebookEdit", "apply_patch", "fs_write"];

/** Product names that would pin a prompt to one platform. */
const PLATFORM_NAMES = ["Claude Code", "Kiro", "Codex"];

function promptFiles(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  for (const kind of ["agents", "skills"]) {
    const dir = join(FACTORY_ROOT, "prompts", kind);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      out.push({ name: `${kind}/${f}`, body: readFileSync(join(dir, f), "utf8") });
    }
  }
  return out;
}

describe("prompt neutrality", () => {
  const files = promptFiles();

  test("there are prompts to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test("no prompt names a platform-specific tool", () => {
    const offenders: string[] = [];
    for (const { name, body } of files) {
      for (const tool of PLATFORM_TOOL_NAMES) {
        if (new RegExp(`\\b${tool}\\b`).test(body)) offenders.push(`${name} → ${tool}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no prompt names a platform", () => {
    const offenders: string[] = [];
    for (const { name, body } of files) {
      for (const platform of PLATFORM_NAMES) {
        if (body.includes(platform)) offenders.push(`${name} → ${platform}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no prompt forbids shell outright", () => {
    // Codex inspects the repo through the shell, so a blanket ban blinds it.
    // Express the intent ("change nothing") instead of banning the mechanism.
    const offenders = files
      .filter(({ body }) => /do not run shell|never run shell|no shell commands/i.test(body))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});
