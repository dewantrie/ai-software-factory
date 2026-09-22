import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Direct unit tests for the source-of-truth guard script (assets/factory-guard.mjs),
// exercised in isolation from the Claude Code adapter: copy the asset + a
// hand-written factory-scope.json into a temp dir, then run real payloads through it.
// (guard.test.ts covers the same script as wired by the adapter; this pins the asset.)

const ASSET = fileURLToPath(new URL("../assets/factory-guard.mjs", import.meta.url));

let dir: string;
let script: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-asset-"));
  script = join(dir, "factory-guard.mjs");
  copyFileSync(ASSET, script);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function withConfig(config: unknown): void {
  writeFileSync(join(dir, "factory-scope.json"), JSON.stringify(config));
}

/** Run the asset with an optional agent arg + payload; return the exit code. */
function run(agent: string, payload: unknown): number {
  try {
    execFileSync("node", agent ? [script, agent] : [script], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return 0;
  } catch (err: any) {
    return err.status ?? 1;
  }
}

function edit(filePath: string) {
  return { cwd: dir, tool_input: { file_path: join(dir, filePath) } };
}

describe("forbidden enforcement", () => {
  beforeEach(() => withConfig({ forbidden: [".env*", "**/secrets.*"], agents: {} }));

  test("blocks a forbidden basename anywhere", () => {
    expect(run("", edit(".env"))).toBe(2);
    expect(run("", edit("config/.env.local"))).toBe(2);
    expect(run("", edit("a/b/secrets.json"))).toBe(2);
  });

  test("allows a non-forbidden path when no agent allow-list applies", () => {
    expect(run("", edit("src/index.ts"))).toBe(0);
  });
});

describe("per-agent allow-list", () => {
  beforeEach(() =>
    withConfig({ forbidden: [".env*"], agents: { "backend-builder": ["src/**"], "test-verifier": ["tests/**/*.{ts,tsx}"] } }),
  );

  test("allows in-scope, blocks out-of-scope", () => {
    expect(run("backend-builder", edit("src/x/y.ts"))).toBe(0);
    expect(run("backend-builder", edit("docs/readme.md"))).toBe(2);
  });

  test("brace globs match both alternatives", () => {
    expect(run("test-verifier", edit("tests/a.test.ts"))).toBe(0);
    expect(run("test-verifier", edit("tests/sub/b.test.tsx"))).toBe(0);
    expect(run("test-verifier", edit("tests/a.test.js"))).toBe(2);
  });

  test("'..' traversal cannot escape the allow-list", () => {
    expect(run("backend-builder", edit("src/../docs/x.md"))).toBe(2);
    expect(run("backend-builder", edit("src/../../evil.ts"))).toBe(2);
    expect(run("backend-builder", edit("src/sub/../ok.ts"))).toBe(0);
  });

  test("forbidden beats an otherwise-allowed area", () => {
    expect(run("backend-builder", edit("src/.env"))).toBe(2);
  });

  test("an agent absent from config is not allow-list enforced", () => {
    expect(run("frontend-builder", edit("anywhere/x.ts"))).toBe(0);
  });
});

describe("symlinks cannot smuggle a path past the globs", () => {
  beforeEach(() => {
    withConfig({ forbidden: [".env*"], agents: { "backend-builder": ["src/**"] } });
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "outside"), { recursive: true });
    writeFileSync(join(dir, ".env"), "SECRET=1\n");
  });

  test("a symlink in an allowed dir pointing at a forbidden file is blocked", () => {
    symlinkSync(join(dir, ".env"), join(dir, "src", "leak.ts"));
    expect(run("backend-builder", edit("src/leak.ts"))).toBe(2);
  });

  test("a symlinked dir inside the allow-list cannot widen it", () => {
    symlinkSync(join(dir, "outside"), join(dir, "src", "out"));
    // The file does not exist yet — the guard must still resolve the linked parent.
    expect(run("backend-builder", edit("src/out/new.ts"))).toBe(2);
  });

  test("real (non-symlinked) paths in the allow-list still pass", () => {
    expect(run("backend-builder", edit("src/real.ts"))).toBe(0);
  });
});

describe("robustness", () => {
  beforeEach(() => withConfig({ forbidden: [".env*"], agents: {} }));

  test("no file path in payload → exit 0", () => {
    expect(run("", { cwd: dir, tool_input: {} })).toBe(0);
  });

  test("malformed (null/garbage) stdin does not crash", () => {
    expect(run("backend-builder", "null")).toBe(0);
    expect(run("backend-builder", "not json")).toBe(0);
  });

  test("honors notebook_path and path as fallbacks", () => {
    expect(run("", { cwd: dir, tool_input: { notebook_path: join(dir, ".env") } })).toBe(2);
    expect(run("", { cwd: dir, tool_input: { path: join(dir, "secrets.x") } })).toBe(0);
  });
});
