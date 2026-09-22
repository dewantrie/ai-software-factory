import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrompts } from "../src/render.js";
import { claudeCode } from "../src/platforms/claude-code.js";
import { kiro } from "../src/platforms/kiro.js";
import { codex } from "../src/platforms/codex.js";
import type { Manifest } from "../src/manifest.js";
import type { PlatformAdapter } from "../src/platforms/index.js";

// Golden-file tests. The rest of the suite asserts *behaviour* ("a hook block is
// present", "the count is N"); these pin the *bytes* every consuming repo receives,
// so any change to adapter output shows up as a reviewable diff instead of landing
// silently in every repo on the next `factory install`.
//
// Two snapshots, deliberately split:
//   - "file tree"       real prompts, paths only. Catches a file appearing,
//                       disappearing or being renamed. Editing a prompt does not
//                       churn it.
//   - "composed output" synthetic minimal prompts + profile, full contents. Shows
//                       exactly what each adapter wraps around a body, small enough
//                       to read in a diff.
//
// Update deliberately, never reflexively: `pnpm test -- -u`, then read the diff —
// it is the change your consumers will get.

const FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Exercises every path key and every platform. */
const MANIFEST: Manifest = {
  name: "golden-api",
  layer: "fullstack",
  profile: "golden-profile",
  contractsRepo: "../contracts",
  commands: { typecheck: "TYPECHECK", lint: "LINT", test: "TEST", acceptance: "ACCEPTANCE" },
  paths: {
    backend: ["src/server/**"],
    frontend: ["src/ui/**"],
    shared: ["src/shared/**"],
    migrations: ["db/migrations/**"],
    infra: [".github/workflows/**"],
    tests: ["tests/acceptance/**"],
    docs: ["docs/**", "CHANGELOG.md"],
    forbidden: [".env*", "**/secrets.*"],
  },
  dontDo: ["Do not call the legacy /v1 endpoints."],
  platforms: ["claude-code", "kiro", "codex"],
  notes: "Golden fixture manifest.",
};

// Stand-ins for the real prompts/profile. Keeping the bodies tiny means the
// snapshot shows the adapter's own composition — frontmatter, headings, ordering —
// rather than 1,900 lines of prompt text repeated across three platforms.
const MINI_AGENTS = [
  { name: "backend-builder", body: "# Backend Builder\n\nRead {{CONTEXT_FILE}} before editing.\n" },
  { name: "researcher", body: "# Researcher\n\nRead {{CONTEXT_FILE}} first. Read-only.\n" },
];
const MINI_SKILLS = [
  { name: "feature-factory", body: "# Feature Factory\n\nFull chain. Use when the work spans layers.\n" },
];
const MINI_PROFILE = "## Architecture rules\n\n- RULE-A\n- RULE-B\n\n## Don't do\n\n- NEVER-X\n";

/** Assets copied verbatim; pinned by byte-identity below, not by snapshot text. */
const COPIED_ASSETS: Record<string, string> = {
  ".claude/hooks/factory-guard.mjs": "assets/factory-guard.mjs",
  ".kiro/factory-guard.mjs": "assets/factory-guard.mjs",
  ".codex/factory-check.mjs": "assets/factory-check.mjs",
};

const ADAPTERS: PlatformAdapter[] = [claudeCode, kiro, codex];

let target: string;
beforeEach(() => {
  target = mkdtempSync(join(tmpdir(), "factory-golden-"));
});
afterEach(() => {
  rmSync(target, { recursive: true, force: true });
});

/** Every file under `root`, as sorted repo-relative POSIX paths. */
function walk(root: string, dir: string = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(root, p, out);
    else out.push(relative(root, p).split(sep).join("/"));
  }
  return out.sort();
}

async function generateAll(args: {
  agents: { name: string; body: string }[];
  skills: { name: string; body: string }[];
  profileBody: string;
}): Promise<void> {
  for (const adapter of ADAPTERS) {
    await adapter.generate({ targetRoot: target, manifest: MANIFEST, ...args });
  }
}

describe("golden: file tree", () => {
  test("the set of generated paths is stable across all three adapters", async () => {
    const { agents, skills } = loadPrompts(FACTORY_ROOT);
    await generateAll({ agents, skills, profileBody: MINI_PROFILE });
    expect(walk(target).join("\n")).toMatchSnapshot();
  });
});

describe("golden: composed output", () => {
  test("every generated file's contents are stable", async () => {
    await generateAll({ agents: MINI_AGENTS, skills: MINI_SKILLS, profileBody: MINI_PROFILE });

    const rendered = walk(target)
      .map((p) => {
        const body =
          p in COPIED_ASSETS
            ? `<verbatim copy of ${COPIED_ASSETS[p]} — see the byte-identity test>\n`
            : readFileSync(join(target, p), "utf8");
        return `===== ${p} =====\n${body}`;
      })
      .join("\n");

    expect(rendered).toMatchSnapshot();
  });

  test("copied guard assets are byte-identical to the source of truth", async () => {
    await generateAll({ agents: MINI_AGENTS, skills: MINI_SKILLS, profileBody: MINI_PROFILE });
    for (const [copied, source] of Object.entries(COPIED_ASSETS)) {
      expect(readFileSync(join(target, copied), "utf8")).toBe(
        readFileSync(join(FACTORY_ROOT, source), "utf8"),
      );
    }
  });
});
