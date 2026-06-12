import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { loadPrompts, loadProfile } from "../src/render.js";
import { claudeCode } from "../src/platforms/claude-code.js";
import type { Manifest } from "../src/manifest.js";

const FACTORY_ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const { agents, skills } = loadPrompts(FACTORY_ROOT);
const profileBody = loadProfile(FACTORY_ROOT, "node-fastify");

let target: string;
beforeEach(() => {
  target = mkdtempSync(join(tmpdir(), "factory-guard-"));
});
afterEach(() => {
  rmSync(target, { recursive: true, force: true });
});

function manifest(forbidden: string[]): Manifest {
  return {
    name: "demo",
    layer: "backend",
    profile: "node-fastify",
    commands: { typecheck: "tc", lint: "ln", test: "ts" },
    paths: { backend: ["src/**"], forbidden },
    platforms: ["claude-code"],
  };
}

async function generate(forbidden: string[]) {
  return claudeCode.generate({ targetRoot: target, manifest: manifest(forbidden), agents, skills, profileBody });
}

function settings(): any {
  return JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8"));
}

/** Run the generated guard with a tool_input.file_path; return the process exit code. */
function runGuard(filePath: string): number {
  const script = join(target, ".claude", "hooks", "factory-guard.mjs");
  const input = JSON.stringify({ cwd: target, tool_input: { file_path: filePath } });
  try {
    execFileSync("node", [script], { input, stdio: ["pipe", "pipe", "pipe"] });
    return 0;
  } catch (err: any) {
    return err.status ?? 1;
  }
}

describe("path guard generation", () => {
  test("writes the guard script + a PreToolUse hook when forbidden is non-empty", async () => {
    await generate([".env*", "**/secrets.*"]);
    expect(existsSync(join(target, ".claude", "hooks", "factory-guard.mjs"))).toBe(true);

    const hooks = settings().hooks.PreToolUse;
    expect(hooks).toHaveLength(1);
    expect(hooks[0].matcher).toContain("Edit");
    expect(hooks[0].hooks[0].command).toContain("factory-guard.mjs");
  });

  test("does NOT write a guard when forbidden is empty", async () => {
    await generate([]);
    expect(existsSync(join(target, ".claude", "hooks", "factory-guard.mjs"))).toBe(false);
    expect(existsSync(join(target, ".claude", "settings.json"))).toBe(false);
  });
});

describe("path guard behavior", () => {
  beforeEach(async () => {
    await generate([".env*", "**/secrets.*", "src/legacy/**"]);
  });

  test.each([
    `${"/ROOT"}/.env`,
    `${"/ROOT"}/.env.local`,
    `${"/ROOT"}/config/secrets.json`,
    `${"/ROOT"}/src/legacy/old.ts`,
  ])("blocks forbidden path %s (exit 2)", (p) => {
    expect(runGuard(p.replace("/ROOT", target))).toBe(2);
  });

  test.each([
    `${"/ROOT"}/src/routes/billing.ts`,
    `${"/ROOT"}/README.md`,
    `${"/ROOT"}/src/services/invoice.ts`,
  ])("allows non-forbidden path %s (exit 0)", (p) => {
    expect(runGuard(p.replace("/ROOT", target))).toBe(0);
  });

  test("exits 0 when there is no file path in the payload", () => {
    const script = join(target, ".claude", "hooks", "factory-guard.mjs");
    expect(() =>
      execFileSync("node", [script], { input: JSON.stringify({ tool_input: {} }), stdio: ["pipe", "pipe", "pipe"] }),
    ).not.toThrow();
  });
});

describe("settings.json merge", () => {
  test("preserves unrelated settings and other PreToolUse hooks", async () => {
    const settingsPath = join(target, ".claude", "settings.json");
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        model: "opus",
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo other" }] }] },
      }),
    );

    await generate([".env*"]);
    const s = settings();
    expect(s.model).toBe("opus"); // unrelated key preserved
    const commands = s.hooks.PreToolUse.flatMap((e: any) => e.hooks.map((h: any) => h.command));
    expect(commands).toContain("echo other"); // pre-existing hook preserved
    expect(commands.some((c: string) => c.includes("factory-guard.mjs"))).toBe(true); // ours added
  });

  test("re-install is idempotent — no duplicate guard hook", async () => {
    await generate([".env*"]);
    await generate([".env*"]);
    const ours = settings().hooks.PreToolUse.filter((e: any) =>
      e.hooks.some((h: any) => h.command.includes("factory-guard.mjs")),
    );
    expect(ours).toHaveLength(1);
  });

  test("toggling forbidden to empty strips the guard hook but keeps other settings", async () => {
    await generate([".env*"]); // adds guard
    // add an unrelated key alongside
    const p = join(target, ".claude", "settings.json");
    const s = settings();
    s.model = "sonnet";
    writeFileSync(p, JSON.stringify(s));

    await generate([]); // should remove our hook
    const after = settings();
    expect(after.model).toBe("sonnet");
    const hasOurs = (after.hooks?.PreToolUse ?? []).some((e: any) =>
      e.hooks.some((h: any) => h.command.includes("factory-guard.mjs")),
    );
    expect(hasOurs).toBe(false);
  });
});
