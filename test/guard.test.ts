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

function manifest(paths: Partial<Manifest["paths"]>): Manifest {
  return {
    name: "demo",
    layer: "backend",
    profile: "node-fastify",
    commands: { typecheck: "tc", lint: "ln", test: "ts" },
    paths,
    platforms: ["claude-code"],
  };
}

async function generate(paths: Partial<Manifest["paths"]>) {
  return claudeCode.generate({ targetRoot: target, manifest: manifest(paths), agents, skills, profileBody });
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
  test("writes the guard script + config + session hook when forbidden is set", async () => {
    await generate({ forbidden: [".env*", "**/secrets.*"] });
    expect(existsSync(join(target, ".claude", "hooks", "factory-guard.mjs"))).toBe(true);
    expect(existsSync(join(target, ".claude", "hooks", "factory-scope.json"))).toBe(true);

    const hooks = settings().hooks.PreToolUse;
    expect(hooks).toHaveLength(1);
    expect(hooks[0].hooks[0].command).toContain("factory-guard.mjs");
  });

  test("writes script + config but NO session hook when only allow-lists are set", async () => {
    await generate({ backend: ["src/**"] });
    expect(existsSync(join(target, ".claude", "hooks", "factory-guard.mjs"))).toBe(true);
    expect(existsSync(join(target, ".claude", "hooks", "factory-scope.json"))).toBe(true);
    expect(existsSync(join(target, ".claude", "settings.json"))).toBe(false);
  });

  test("writes nothing when there is nothing to enforce", async () => {
    await generate({});
    expect(existsSync(join(target, ".claude", "hooks", "factory-guard.mjs"))).toBe(false);
    expect(existsSync(join(target, ".claude", "hooks", "factory-scope.json"))).toBe(false);
    expect(existsSync(join(target, ".claude", "settings.json"))).toBe(false);
  });

  test("factory-scope.json lists only agents whose list is present", async () => {
    await generate({ backend: ["src/**"], docs: ["docs/**"], forbidden: [".env*"] });
    const cfg = JSON.parse(readFileSync(join(target, ".claude", "hooks", "factory-scope.json"), "utf8"));
    expect(cfg.forbidden).toEqual([".env*"]);
    expect(Object.keys(cfg.agents).sort()).toEqual(["backend-builder", "doc-writer"]);
    expect(cfg.agents["backend-builder"]).toEqual(["src/**"]);
  });
});

describe("path guard behavior", () => {
  beforeEach(async () => {
    await generate({ forbidden: [".env*", "**/secrets.*", "src/legacy/**"] });
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

describe("lifecycle hooks (opt-in)", () => {
  async function generateWith(hooks?: Manifest["hooks"]) {
    return claudeCode.generate({
      targetRoot: target,
      manifest: { ...manifest({ forbidden: [".env*"] }), hooks },
      agents,
      skills,
      profileBody,
    });
  }
  const has = (p: string) => existsSync(join(target, ".claude", "hooks", p));
  const events = () => Object.keys(settings().hooks ?? {});

  test("off by default — no scripts, no Stop/SubagentStop entries", async () => {
    await generateWith();
    expect(has("factory-stop.mjs")).toBe(false);
    expect(has("factory-capture.mjs")).toBe(false);
    expect(events()).toEqual(["PreToolUse"]);
  });

  test("stop-on-failing-validation wires the Stop hook and its command config", async () => {
    await generateWith({ stopOnFailingValidation: true });
    expect(has("factory-stop.mjs")).toBe(true);
    expect(events()).toContain("Stop");

    // The hook re-runs the repo's commands, so they must be on disk for it.
    const cfg = JSON.parse(readFileSync(join(target, ".claude", "hooks", "factory-stop.json"), "utf8"));
    expect(cfg).toEqual({ test: "ts", typecheck: "tc" });
  });

  test("capture-agent-output wires the SubagentStop hook", async () => {
    await generateWith({ captureAgentOutput: true });
    expect(has("factory-capture.mjs")).toBe(true);
    expect(events()).toContain("SubagentStop");
  });

  test("turning a hook back off removes its script, config and settings entry", async () => {
    await generateWith({ stopOnFailingValidation: true, captureAgentOutput: true });
    await generateWith();
    expect(has("factory-stop.mjs")).toBe(false);
    expect(has("factory-stop.json")).toBe(false);
    expect(has("factory-capture.mjs")).toBe(false);
    expect(events()).toEqual(["PreToolUse"]);
  });

  test("leaves a user's own hook on the same event alone", async () => {
    const p = join(target, ".claude", "settings.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } }),
    );

    await generateWith({ stopOnFailingValidation: true });
    await generateWith({ stopOnFailingValidation: true }); // idempotent
    const commands = settings().hooks.Stop.flatMap((e: any) => e.hooks.map((h: any) => h.command));
    expect(commands.filter((c: string) => c === "echo mine")).toHaveLength(1);
    expect(commands.filter((c: string) => c.includes("factory-stop.mjs"))).toHaveLength(1);

    await generateWith(); // ours removed, theirs kept
    expect(settings().hooks.Stop.flatMap((e: any) => e.hooks.map((h: any) => h.command))).toEqual(["echo mine"]);
  });
});

describe("sandbox (opt-in)", () => {
  async function generateSandbox(sandbox: boolean, forbidden = [".env*", "**/secrets.*"]) {
    return claudeCode.generate({
      targetRoot: target,
      manifest: { ...manifest({ forbidden }), sandbox: sandbox || undefined },
      agents,
      skills,
      profileBody,
    });
  }

  test("off by default — no sandbox block at all", async () => {
    await generateSandbox(false);
    expect(settings().sandbox).toBeUndefined();
  });

  test("on: enables the sandbox and denies writes to every forbidden glob", async () => {
    await generateSandbox(true);
    expect(settings().sandbox.enabled).toBe(true);
    // Both forms per glob: root-anchored and any-depth (the syntaxes disagree
    // on whether a leading double-star also matches zero segments).
    expect(settings().sandbox.filesystem.denyWrite).toEqual([
      "./.env*",
      "./**/.env*",
      "./secrets.*",
      "./**/secrets.*",
    ]);
  });

  test("is idempotent and keeps the user's own denyWrite entries", async () => {
    const p = join(target, ".claude", "settings.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ sandbox: { filesystem: { denyWrite: ["./vendor"] } } }));

    await generateSandbox(true, [".env*"]);
    await generateSandbox(true, [".env*"]);
    expect(settings().sandbox.filesystem.denyWrite).toEqual(["./vendor", "./.env*", "./**/.env*"]);
  });

  test("turning it off removes our rules and the bare enabled flag we wrote", async () => {
    await generateSandbox(true, [".env*"]);
    await generateSandbox(false, [".env*"]);
    expect(settings().sandbox).toBeUndefined();
  });

  test("turning it off leaves a sandbox the user configured themselves", async () => {
    const p = join(target, ".claude", "settings.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ sandbox: { enabled: true, network: { allowedDomains: ["github.com"] } } }));

    await generateSandbox(true, [".env*"]);
    await generateSandbox(false, [".env*"]);
    const s = settings().sandbox;
    expect(s.enabled).toBe(true); // theirs, not ours to remove
    expect(s.network.allowedDomains).toEqual(["github.com"]);
    expect(s.filesystem).toBeUndefined(); // ours, cleaned up
  });
});

describe("permissions.deny from forbidden", () => {
  const deny = () => settings().permissions?.deny;

  test("each forbidden glob becomes an Edit() rule", async () => {
    await generate({ forbidden: [".env*", "**/secrets.*"] });
    expect(deny()).toEqual(["Edit(.env*)", "Edit(**/secrets.*)"]);
  });

  test("uses Edit(), never Write() — only Read/Edit path rules are consulted", async () => {
    await generate({ forbidden: [".env*"] });
    for (const rule of deny() as string[]) {
      expect(rule.startsWith("Edit(")).toBe(true);
    }
  });

  test("does not deny reads — forbidden means 'may not edit'", async () => {
    await generate({ forbidden: [".env*"] });
    expect(JSON.stringify(deny())).not.toContain("Read(");
  });

  test("preserves the user's own deny rules and is idempotent", async () => {
    const p = join(target, ".claude", "settings.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ permissions: { deny: ["Bash(rm *)"], allow: ["Bash(pnpm *)"] } }));

    await generate({ forbidden: [".env*"] });
    await generate({ forbidden: [".env*"] });

    expect(deny()).toEqual(["Bash(rm *)", "Edit(.env*)"]); // no duplicate
    expect(settings().permissions.allow).toEqual(["Bash(pnpm *)"]);
  });

  test("a shrunk forbidden list prunes the stale rule it owned", async () => {
    await generate({ forbidden: [".env*", "**/secrets.*"] });
    await generate({ forbidden: [".env*"] });
    expect(deny()).toEqual(["Edit(.env*)"]);
  });

  test("dropping forbidden entirely removes our rules but keeps the user's", async () => {
    const p = join(target, ".claude", "settings.json");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ permissions: { deny: ["Bash(rm *)"] } }));

    await generate({ forbidden: [".env*"] });
    await generate({}); // no scope at all
    expect(deny()).toEqual(["Bash(rm *)"]);
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

    await generate({ forbidden: [".env*"] });
    const s = settings();
    expect(s.model).toBe("opus"); // unrelated key preserved
    const commands = s.hooks.PreToolUse.flatMap((e: any) => e.hooks.map((h: any) => h.command));
    expect(commands).toContain("echo other"); // pre-existing hook preserved
    expect(commands.some((c: string) => c.includes("factory-guard.mjs"))).toBe(true); // ours added
  });

  test("re-install is idempotent — no duplicate guard hook", async () => {
    await generate({ forbidden: [".env*"] });
    await generate({ forbidden: [".env*"] });
    const ours = settings().hooks.PreToolUse.filter((e: any) =>
      e.hooks.some((h: any) => h.command.includes("factory-guard.mjs")),
    );
    expect(ours).toHaveLength(1);
  });

  test("toggling forbidden to empty strips the guard hook but keeps other settings", async () => {
    await generate({ forbidden: [".env*"] }); // adds guard
    // add an unrelated key alongside
    const p = join(target, ".claude", "settings.json");
    const s = settings();
    s.model = "sonnet";
    writeFileSync(p, JSON.stringify(s));

    await generate({}); // should remove our hook
    const after = settings();
    expect(after.model).toBe("sonnet");
    const hasOurs = (after.hooks?.PreToolUse ?? []).some((e: any) =>
      e.hooks.some((h: any) => h.command.includes("factory-guard.mjs")),
    );
    expect(hasOurs).toBe(false);
  });
});

describe("per-agent allow-list enforcement", () => {
  beforeEach(async () => {
    await generate({ backend: ["src/**"], docs: ["docs/**", "CHANGELOG.md"], forbidden: [".env*"] });
  });

  function runGuardAs(agent: string, filePath: string): number {
    const script = join(target, ".claude", "hooks", "factory-guard.mjs");
    const input = JSON.stringify({ cwd: target, tool_input: { file_path: filePath } });
    try {
      execFileSync("node", [script, agent], { input, stdio: ["pipe", "pipe", "pipe"] });
      return 0;
    } catch (err: any) {
      return err.status ?? 1;
    }
  }

  test("backend-builder may edit its allow-list, not another agent's", () => {
    expect(runGuardAs("backend-builder", join(target, "src/routes/x.ts"))).toBe(0);
    expect(runGuardAs("backend-builder", join(target, "docs/guide.md"))).toBe(2);
  });

  test("doc-writer may edit docs, not backend", () => {
    expect(runGuardAs("doc-writer", join(target, "docs/guide.md"))).toBe(0);
    expect(runGuardAs("doc-writer", join(target, "CHANGELOG.md"))).toBe(0);
    expect(runGuardAs("doc-writer", join(target, "src/routes/x.ts"))).toBe(2);
  });

  test("forbidden still blocks even for an agent's own allowed area", () => {
    expect(runGuardAs("backend-builder", join(target, "src/.env"))).toBe(2);
  });

  test("an agent with no list (opt-in absent) is not allow-list enforced", () => {
    expect(runGuardAs("frontend-builder", join(target, "anywhere/x.ts"))).toBe(0);
  });

  test("'..' traversal cannot escape an allow-list", () => {
    // src/../docs/x.md normalizes to docs/x.md → outside backend-builder's src/** → blocked
    expect(runGuardAs("backend-builder", join(target, "src/../docs/x.md"))).toBe(2);
    // escaping the repo entirely is likewise blocked for a scoped agent
    expect(runGuardAs("backend-builder", join(target, "src/../../evil.ts"))).toBe(2);
    // a normalized in-scope path is still allowed
    expect(runGuardAs("backend-builder", join(target, "src/sub/../routes/a.ts"))).toBe(0);
  });

  test("a malformed (null) stdin payload does not crash the guard", () => {
    const script = join(target, ".claude", "hooks", "factory-guard.mjs");
    expect(() =>
      execFileSync("node", [script, "backend-builder"], { input: "null", stdio: ["pipe", "pipe", "pipe"] }),
    ).not.toThrow();
  });
});

describe("brace-glob allow-lists (e.g. *.test.{ts,tsx})", () => {
  beforeEach(async () => {
    await generate({ tests: ["src/**/*.test.{ts,tsx}"], forbidden: [".env*"] });
  });

  function runGuardAs(agent: string, filePath: string): number {
    const script = join(target, ".claude", "hooks", "factory-guard.mjs");
    const input = JSON.stringify({ cwd: target, tool_input: { file_path: filePath } });
    try {
      execFileSync("node", [script, agent], { input, stdio: ["pipe", "pipe", "pipe"] });
      return 0;
    } catch (err: any) {
      return err.status ?? 1;
    }
  }

  test("test-verifier may edit both brace alternatives", () => {
    expect(runGuardAs("test-verifier", join(target, "src/a.test.ts"))).toBe(0);
    expect(runGuardAs("test-verifier", join(target, "src/components/b.test.tsx"))).toBe(0);
  });

  test("test-verifier is still blocked outside the brace pattern", () => {
    expect(runGuardAs("test-verifier", join(target, "src/a.ts"))).toBe(2);
    expect(runGuardAs("test-verifier", join(target, "src/a.test.js"))).toBe(2);
  });
});
