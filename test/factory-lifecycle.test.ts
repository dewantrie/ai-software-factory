import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Direct unit tests for the two lifecycle hook assets, exercised in isolation
// from the adapter (adapters/guard tests cover the wiring). Same shape as
// factory-guard.test.ts: copy the asset into a temp dir, feed it real payloads.

const STOP_ASSET = fileURLToPath(new URL("../assets/factory-stop.mjs", import.meta.url));
const CAPTURE_ASSET = fileURLToPath(new URL("../assets/factory-capture.mjs", import.meta.url));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-lifecycle-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Run a hook script with a payload; return its exit code. */
function run(script: string, payload: unknown): number {
  try {
    execFileSync("node", [script], {
      input: JSON.stringify(payload),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return 0;
  } catch (err: any) {
    return err.status ?? 1;
  }
}

describe("factory-stop.mjs", () => {
  let script: string;

  beforeEach(() => {
    mkdirSync(join(dir, "hooks"), { recursive: true });
    script = join(dir, "hooks", "factory-stop.mjs");
    copyFileSync(STOP_ASSET, script);
  });

  function withCommands(commands: Record<string, string>): void {
    writeFileSync(join(dir, "hooks", "factory-stop.json"), JSON.stringify(commands));
  }

  /**
   * Commit everything present so far. The hook script and its config live
   * inside the repo in real installs (.claude/hooks/) and are committed with
   * it, so leaving them untracked here would make every tree "dirty".
   */
  function gitRepo(): void {
    execSync("git init -q && git config user.email t@t && git config user.name t", { cwd: dir });
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    execSync("git add -A && git commit -qm seed", { cwd: dir });
  }

  function dirty(): void {
    writeFileSync(join(dir, "seed.txt"), "changed\n");
  }

  const stop = (extra: Record<string, unknown> = {}) => run(script, { cwd: dir, ...extra });

  test("a clean tree exits 0 without running the commands", () => {
    withCommands({ test: "exit 1" }); // would fail if it ran
    gitRepo();
    expect(stop()).toBe(0);
  });

  test("a dirty tree with passing commands exits 0", () => {
    withCommands({ typecheck: "true", test: "true" });
    gitRepo();
    dirty();
    expect(stop()).toBe(0);
  });

  test("a dirty tree with a failing command blocks the stop", () => {
    withCommands({ test: "exit 1" });
    gitRepo();
    dirty();
    expect(stop()).toBe(2);
  });

  test("stop_hook_active short-circuits, so a block can never loop", () => {
    withCommands({ test: "exit 1" });
    gitRepo();
    dirty();
    expect(stop()).toBe(2);
    expect(stop({ stop_hook_active: true })).toBe(0);
  });

  test("the same failing state is reported once, not every turn", () => {
    withCommands({ test: "exit 1" });
    gitRepo();
    dirty();
    expect(stop()).toBe(2);
    expect(stop()).toBe(0); // unchanged tree → already reported
    writeFileSync(join(dir, "seed.txt"), "changed again\n");
    expect(stop()).toBe(2); // new state → reported again
  });

  test("opts out when there is no git repo or no config", () => {
    withCommands({ test: "exit 1" });
    expect(stop()).toBe(0); // not a git repo

    rmSync(join(dir, "hooks", "factory-stop.json"));
    gitRepo();
    dirty();
    expect(stop()).toBe(0); // no config
  });
});

describe("factory-capture.mjs", () => {
  let script: string;

  beforeEach(() => {
    script = join(dir, "factory-capture.mjs");
    copyFileSync(CAPTURE_ASSET, script);
  });

  const runsDir = (session: string) => join(dir, ".factory", "runs", session);

  test("records an agent's final message, numbered in order", () => {
    expect(
      run(script, { cwd: dir, session_id: "s1", agent_type: "researcher", last_assistant_message: "findings" }),
    ).toBe(0);
    expect(
      run(script, { cwd: dir, session_id: "s1", agent_type: "backend-builder", last_assistant_message: "built" }),
    ).toBe(0);

    expect(readdirSync(runsDir("s1")).sort()).toEqual(["01-researcher.md", "02-backend-builder.md"]);
    const body = readFileSync(join(runsDir("s1"), "01-researcher.md"), "utf8");
    expect(body).toContain("agent: researcher");
    expect(body).toContain("findings");
  });

  test("never blocks, whatever it is handed", () => {
    expect(run(script, { cwd: dir })).toBe(0); // no message
    expect(run(script, { cwd: dir, last_assistant_message: "   " })).toBe(0); // blank
    expect(run(script, null)).toBe(0);
  });

  test("sanitizes ids so they cannot escape the runs directory", () => {
    expect(
      run(script, {
        cwd: dir,
        session_id: "../../escape",
        agent_type: "../evil",
        last_assistant_message: "x",
      }),
    ).toBe(0);
    const sessions = readdirSync(join(dir, ".factory", "runs"));
    expect(sessions).toEqual(["escape"]);
    expect(readdirSync(runsDir("escape"))).toEqual(["01-evil.md"]);
  });
});
