import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPrompts, loadProfile } from "../src/render.js";
import { claudeCode } from "../src/platforms/claude-code.js";
import { kiro } from "../src/platforms/kiro.js";
import { codex } from "../src/platforms/codex.js";
import { cursor } from "../src/platforms/cursor.js";
import { windsurf } from "../src/platforms/windsurf.js";
import { getAdapter, allPlatforms } from "../src/platforms/index.js";
import type { Manifest } from "../src/manifest.js";

const FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const manifest: Manifest = {
  name: "billing-api",
  layer: "backend",
  profile: "node-fastify",
  contractsRepo: "../contracts",
  commands: { typecheck: "pnpm typecheck", lint: "pnpm lint", test: "pnpm test", acceptance: "pnpm test:integration" },
  paths: { backend: ["src/**"], forbidden: [".env*"] },
  dontDo: ["Do not call /v1"],
  platforms: ["claude-code", "kiro", "codex"],
};

const { agents, skills } = loadPrompts(FACTORY_ROOT);
const profileBody = loadProfile(FACTORY_ROOT, "node-fastify");

let target: string;
beforeEach(() => {
  target = mkdtempSync(join(tmpdir(), "factory-adapter-"));
});
afterEach(() => {
  rmSync(target, { recursive: true, force: true });
});

function genArgs() {
  return { targetRoot: target, manifest, agents, skills, profileBody };
}

describe("fixture sanity", () => {
  test("there are agents and skills to render", () => {
    expect(agents.length).toBeGreaterThan(0);
    expect(skills.map((s) => s.name).sort()).toEqual(["feature-factory", "quick-fix", "spike"]);
  });
});

describe("claude-code adapter", () => {
  test("writes CLAUDE.md + one file per agent + one SKILL.md per skill", async () => {
    const res = await claudeCode.generate(genArgs());
    // CLAUDE.md + agents + skills + scope config + guard script + settings.json (manifest has a forbidden list)
    expect(res.filesWritten.length).toBe(1 + agents.length + skills.length + 3);

    const claudeMd = readFileSync(join(target, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("# CLAUDE.md");
    expect(claudeMd).toContain("billing-api");

    // Every agent file exists with Claude-Code frontmatter and substituted context var
    for (const a of agents) {
      const body = readFileSync(join(target, ".claude", "agents", `${a.name}.md`), "utf8");
      expect(body.startsWith("---")).toBe(true);
      expect(body).toContain(`name: ${a.name}`);
      expect(body).toContain("tools:");
      expect(body).not.toContain("{{CONTEXT_FILE}}");
    }

    for (const s of skills) {
      expect(existsSync(join(target, ".claude", "skills", s.name, "SKILL.md"))).toBe(true);
    }
  });

  test("skill descriptions use the real prose paragraph, not the '<name> orchestrator.' fallback", async () => {
    await claudeCode.generate(genArgs());
    const descLine = (skill: string): string => {
      const body = readFileSync(join(target, ".claude", "skills", skill, "SKILL.md"), "utf8");
      return body.split("\n").find((l) => l.startsWith("description:")) ?? "";
    };
    // The frontmatter description carries the real trigger text, not "<name> orchestrator."
    expect(descLine("feature-factory")).toMatch(/^description: Full 12-agent chain.*Use when/);
    expect(descLine("spike")).toMatch(/^description: Research-only chain\. Use when/);
    for (const s of ["feature-factory", "quick-fix", "spike"]) {
      expect(descLine(s)).not.toBe(`description: ${s} orchestrator.`);
    }
  });

  test("substitutes {{CONTEXT_FILE}} with CLAUDE.md in agent bodies", async () => {
    await claudeCode.generate(genArgs());
    const backend = readFileSync(join(target, ".claude", "agents", "backend-builder.md"), "utf8");
    expect(backend).toContain("CLAUDE.md");
  });

  test("emits a per-agent PreToolUse hook only for agents with an allow-list", async () => {
    await claudeCode.generate(genArgs()); // manifest has paths.backend, no docs
    const backend = readFileSync(join(target, ".claude", "agents", "backend-builder.md"), "utf8");
    expect(backend).toContain("hooks:");
    expect(backend).toContain("PreToolUse:");
    expect(backend).toContain('factory-guard.mjs" backend-builder');

    // doc-writer has no `docs` list in this manifest → no hook block
    const doc = readFileSync(join(target, ".claude", "agents", "doc-writer.md"), "utf8");
    expect(doc).not.toContain("hooks:");

    // read-only agent never gets a hook
    const researcher = readFileSync(join(target, ".claude", "agents", "researcher.md"), "utf8");
    expect(researcher).not.toContain("hooks:");
  });

  test("generated agent frontmatter with a hook block is valid YAML", async () => {
    const { parse } = await import("yaml");
    await claudeCode.generate(genArgs());
    const body = readFileSync(join(target, ".claude", "agents", "backend-builder.md"), "utf8");
    const fm = body.split("---")[1]; // text between the first pair of --- fences
    const parsed = parse(fm) as any;
    expect(parsed.name).toBe("backend-builder");
    expect(parsed.hooks.PreToolUse[0].matcher).toContain("Edit");
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toContain("backend-builder");
  });
});

describe("kiro adapter", () => {
  test("writes project.md + agent-*/skill-* steering files + FACTORY.md", async () => {
    const res = await kiro.generate(genArgs());
    expect(res.filesWritten.length).toBe(1 + agents.length + skills.length + 1);

    const project = readFileSync(join(target, ".kiro", "steering", "project.md"), "utf8");
    expect(project).toContain("inclusion: always");

    const agentFile = readFileSync(
      join(target, ".kiro", "steering", `agent-${agents[0]!.name}.md`),
      "utf8",
    );
    expect(agentFile).toContain("inclusion: manual");
    expect(agentFile).toContain(".kiro/steering/project.md");
    expect(agentFile).not.toContain("{{CONTEXT_FILE}}");
  });
});

describe("codex adapter", () => {
  test("writes AGENTS.md + agent files + 3 executable orchestrators + FACTORY.md + scope guard", async () => {
    const res = await codex.generate(genArgs());
    // AGENTS.md + agents + orchestrators + FACTORY.md + factory-scope.json + factory-check.mjs
    // (the genArgs manifest has backend + forbidden → scope is enforced)
    expect(res.filesWritten.length).toBe(1 + agents.length + skills.length + 1 + 2);

    expect(existsSync(join(target, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(target, ".codex", "factory-scope.json"))).toBe(true);
    expect(existsSync(join(target, ".codex", "factory-check.mjs"))).toBe(true);

    const scripts = ["feature-factory.sh", "quick-fix.sh", "spike.sh"];
    for (const name of scripts) {
      const p = join(target, ".codex", "orchestrator", name);
      expect(existsSync(p)).toBe(true);
      // Executable bit set
      expect(statSync(p).mode & 0o111).not.toBe(0);
      // Valid bash (syntax check, doesn't execute)
      expect(() => execFileSync("bash", ["-n", p])).not.toThrow();
    }
  });

  test("orchestrators enforce scope around editing agents (not read-only ones)", async () => {
    await codex.generate(genArgs());
    const ff = readFileSync(join(target, ".codex", "orchestrator", "feature-factory.sh"), "utf8");
    expect(ff).toContain("enforce_scope()");
    expect(ff).toContain("enforce_scope backend-builder");
    expect(ff).toContain("enforce_scope doc-writer");
    // researcher is read-only — no enforce call for it
    expect(ff).not.toContain("enforce_scope researcher");

    const qf = readFileSync(join(target, ".codex", "orchestrator", "quick-fix.sh"), "utf8");
    expect(qf).toContain('enforce_scope "$AGENT"');
  });

  test("omits the scope guard when the manifest declares no scope", async () => {
    const bare: Manifest = {
      name: "bare",
      layer: "backend",
      profile: "node-fastify",
      commands: { typecheck: "tc", lint: "ln", test: "ts" },
      paths: {},
      platforms: ["codex"],
    };
    await codex.generate({ targetRoot: target, manifest: bare, agents, skills, profileBody });
    expect(existsSync(join(target, ".codex", "factory-scope.json"))).toBe(false);
    expect(existsSync(join(target, ".codex", "factory-check.mjs"))).toBe(false);
    // enforce_scope() helper is still defined (a no-op without the scope files)
    const ff = readFileSync(join(target, ".codex", "orchestrator", "feature-factory.sh"), "utf8");
    expect(ff).toContain("scope_active()");
  });

  test("agent bodies substitute {{CONTEXT_FILE}} with AGENTS.md", async () => {
    await codex.generate(genArgs());
    const body = readFileSync(join(target, ".codex", "agents", "backend-builder.md"), "utf8");
    expect(body).toContain("AGENTS.md");
    expect(body).not.toContain("{{CONTEXT_FILE}}");
  });
});

describe("stub adapters", () => {
  test("cursor throws a clear not-implemented error", async () => {
    await expect(cursor.generate(genArgs())).rejects.toThrow(/stub/i);
  });
  test("windsurf throws a clear not-implemented error", async () => {
    await expect(windsurf.generate(genArgs())).rejects.toThrow(/stub/i);
  });
});

describe("registry", () => {
  test("getAdapter returns the matching adapter for every known platform", () => {
    for (const p of allPlatforms) {
      expect(getAdapter(p).name).toBe(p);
    }
  });

  test("getAdapter throws on an unknown platform", () => {
    // @ts-expect-error — intentionally invalid platform
    expect(() => getAdapter("nope")).toThrow(/Unknown platform/);
  });
});
