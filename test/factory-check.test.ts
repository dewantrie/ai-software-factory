import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Direct unit tests for the Codex post-run scope checker (assets/factory-check.mjs),
// in isolation from the adapter: copy the asset + a hand-written factory-scope.json
// into a temp dir, pipe newline paths on stdin, assert exit code + the violation list
// it prints on stdout (the orchestrator reverts exactly those).

const ASSET = fileURLToPath(new URL("../assets/factory-check.mjs", import.meta.url));

let dir: string;
let script: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-check-"));
  script = join(dir, "factory-check.mjs");
  copyFileSync(ASSET, script);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function withConfig(config: unknown): void {
  writeFileSync(join(dir, "factory-scope.json"), JSON.stringify(config));
}

/** Run the checker with an agent arg + newline-joined changed paths; returns {code, violations}. */
function check(agent: string, paths: string[]): { code: number; violations: string[] } {
  try {
    const out = execFileSync("node", [script, agent], {
      input: paths.join("\n"),
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { code: 0, violations: out.split("\n").map((s) => s.trim()).filter(Boolean) };
  } catch (err: any) {
    const out = (err.stdout ?? "").toString();
    return { code: err.status ?? 1, violations: out.split("\n").map((s: string) => s.trim()).filter(Boolean) };
  }
}

describe("forbidden", () => {
  beforeEach(() => withConfig({ forbidden: [".env*", "**/secrets.*"], agents: {} }));

  test("flags forbidden paths regardless of agent", () => {
    expect(check("", [".env"]).code).toBe(1);
    expect(check("", ["config/secrets.json"]).violations).toEqual(["config/secrets.json"]);
  });

  test("clean set exits 0 with no violations", () => {
    expect(check("", ["src/a.ts", "README.md"])).toEqual({ code: 0, violations: [] });
  });
});

describe("per-agent allow-list", () => {
  beforeEach(() =>
    withConfig({ forbidden: [".env*"], agents: { "backend-builder": ["src/**"], "doc-writer": ["docs/**", "CHANGELOG.md"] } }),
  );

  test("reports only the out-of-scope files for the acting agent", () => {
    const r = check("backend-builder", ["src/ok.ts", "docs/bad.md", "src/x/y.ts"]);
    expect(r.code).toBe(1);
    expect(r.violations).toEqual(["docs/bad.md"]);
  });

  test("doc-writer's own area passes; backend area fails", () => {
    expect(check("doc-writer", ["docs/a.md", "CHANGELOG.md"]).code).toBe(0);
    expect(check("doc-writer", ["src/a.ts"]).violations).toEqual(["src/a.ts"]);
  });

  test("forbidden beats an agent's allowed area", () => {
    expect(check("backend-builder", ["src/.env"]).code).toBe(1);
  });

  test("an agent absent from config is only forbidden-checked", () => {
    expect(check("frontend-builder", ["anywhere/x.ts"]).code).toBe(0);
  });

  test("brace globs match both alternatives", () => {
    withConfig({ forbidden: [], agents: { "test-verifier": ["tests/**/*.{ts,tsx}"] } });
    expect(check("test-verifier", ["tests/a.test.ts", "tests/sub/b.test.tsx"]).code).toBe(0);
    expect(check("test-verifier", ["tests/a.test.js"]).violations).toEqual(["tests/a.test.js"]);
  });

  test("leading ./ is normalized before matching", () => {
    expect(check("backend-builder", ["./src/a.ts"]).code).toBe(0);
  });
});

describe("robustness", () => {
  beforeEach(() => withConfig({ forbidden: [".env*"], agents: {} }));

  test("empty stdin → exit 0", () => {
    expect(check("backend-builder", [])).toEqual({ code: 0, violations: [] });
  });

  test("blank lines are ignored", () => {
    expect(check("", ["", "  ", "src/a.ts"]).code).toBe(0);
  });
});
