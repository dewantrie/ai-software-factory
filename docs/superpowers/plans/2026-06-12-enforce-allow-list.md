# Enforced per-agent allow-list path scoping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce each Claude Code editing agent's allow-list at the tool level — an edit outside an agent's allowed globs is blocked, not just discouraged — covering all six editing agents.

**Architecture:** Two `PreToolUse` layers. A session-level hook (`.claude/settings.json`) blocks the global `forbidden` list for everyone. A per-agent hook in each editing agent's frontmatter enforces that agent's allow-list. Both are served by one config-driven guard script (`.claude/hooks/factory-guard.mjs`) that reads a generated `.claude/hooks/factory-scope.json`.

**Tech Stack:** TypeScript (strict, ESM, `.js` import specifiers), Node 20, Vitest. Spec: `docs/superpowers/specs/2026-06-12-enforce-allow-list-design.md`.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/manifest.ts` | Manifest types | Add `migrations/infra/docs` to `Paths` |
| `src/render.ts` | CLAUDE.md composition | Render Migration/DevOps/Doc scoping blocks |
| `src/util/profile-defaults.ts` | Parse profile `Default paths` | Add the 3 keys to the type |
| `src/commands/init.ts` | `composeManifest` | Iterate the 3 new keys |
| `src/platforms/claude-code.ts` | Claude Code generation | Config-driven guard + per-agent frontmatter hooks |
| `profiles/*.md` | Stack defaults | Add `migrations/infra/docs` defaults |
| `README.md` | Docs | Document enforcement, keys, limits |
| `test/*.test.ts` | Tests | New + updated coverage |

Conventions to follow: imports use `.js` specifiers; tests live in `test/` and run via `pnpm test`; commits are short, lower-case, no Claude watermark.

---

## Task 1: Extend the `Paths` schema

**Files:**
- Modify: `src/manifest.ts:15-21`
- Test: `test/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/manifest.test.ts` inside the `describe("loadManifest", …)` block:

```ts
  test("loads the new migrations/infra/docs path keys", () => {
    const m = loadManifest(
      writeManifest(
        VALID +
          "  migrations:\n    - prisma/**\n  infra:\n    - .github/workflows/**\n  docs:\n    - docs/**\n",
      ),
    );
    expect(m.paths.migrations).toEqual(["prisma/**"]);
    expect(m.paths.infra).toEqual([".github/workflows/**"]);
    expect(m.paths.docs).toEqual(["docs/**"]);
  });
```

Note: `VALID` already ends with a `paths:` block whose last entry is indented under `paths:`, so the appended keys (2-space indent) nest correctly.

- [ ] **Step 2: Run the test**

Run: `pnpm test -- manifest`
Note: this test likely **passes already** — `normalizeManifest` casts `paths` straight through, so the YAML values flow at runtime even before the type exists, and Vitest erases types. That is expected. This test is a regression guard; the real forcing function for the type change is `tsc` on the `src/` consumers in Tasks 2 and 4, which reference `m.paths.migrations` and will not compile until Step 3 lands. Proceed to Step 3 regardless.

- [ ] **Step 3: Add the keys to `Paths`**

In `src/manifest.ts`, replace the `Paths` interface:

```ts
export interface Paths {
  backend?: string[];
  frontend?: string[];
  shared?: string[];
  forbidden?: string[];
  tests?: string[];
  migrations?: string[];
  infra?: string[];
  docs?: string[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- manifest && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/manifest.ts test/manifest.test.ts
git commit -m "feat(manifest): add migrations/infra/docs path keys"
```

---

## Task 2: Render the new scoping blocks in CLAUDE.md

**Files:**
- Modify: `src/render.ts:95-99` (insert before the Test Verifier block)
- Test: `test/render.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/render.test.ts` inside `describe("buildContextFile", …)`:

```ts
  test("renders migration/devops/doc scoping blocks when present", () => {
    const out = buildContextFile({
      manifest: baseManifest({
        paths: {
          backend: ["src/**"],
          migrations: ["prisma/**"],
          infra: [".github/workflows/**"],
          docs: ["docs/**"],
        },
      }),
      profileBody: "",
      contextFileName: "CLAUDE.md",
      platform: "claude-code",
    });
    expect(out).toContain("**Migration Author may edit:**");
    expect(out).toContain("- `prisma/**`");
    expect(out).toContain("**DevOps Builder may edit:**");
    expect(out).toContain("- `.github/workflows/**`");
    expect(out).toContain("**Doc Writer may edit:**");
    expect(out).toContain("- `docs/**`");
  });

  test("omits migration/devops/doc blocks when absent", () => {
    const out = buildContextFile({
      manifest: baseManifest({ paths: { backend: ["src/**"] } }),
      profileBody: "",
      contextFileName: "CLAUDE.md",
      platform: "claude-code",
    });
    expect(out).not.toContain("Migration Author may edit");
    expect(out).not.toContain("DevOps Builder may edit");
    expect(out).not.toContain("Doc Writer may edit");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- render`
Expected: FAIL — "Migration Author may edit" not found.

- [ ] **Step 3: Insert the render blocks**

In `src/render.ts`, immediately **after** the `frontend` block (the `if (m.paths.frontend …)` block ending at line 94) and **before** the `tests` block, insert:

```ts
  if (m.paths.migrations && m.paths.migrations.length > 0) {
    lines.push("**Migration Author may edit:**");
    m.paths.migrations.forEach((p) => lines.push(`- \`${p}\``));
    lines.push("");
  }
  if (m.paths.infra && m.paths.infra.length > 0) {
    lines.push("**DevOps Builder may edit:**");
    m.paths.infra.forEach((p) => lines.push(`- \`${p}\``));
    lines.push("");
  }
```

Then immediately **after** the `tests` block (the `if (m.paths.tests …)` block) and **before** the `forbidden` block, insert:

```ts
  if (m.paths.docs && m.paths.docs.length > 0) {
    lines.push("**Doc Writer may edit:**");
    m.paths.docs.forEach((p) => lines.push(`- \`${p}\``));
    lines.push("");
  }
```

Final block order under "Path scoping for agents": Backend, Frontend, Migration, DevOps, Test, Doc, Forbidden.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- render && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat(render): show migration/devops/doc scoping blocks in CLAUDE.md"
```

---

## Task 3: Teach profile-defaults + init about the new keys

**Files:**
- Modify: `src/util/profile-defaults.ts:10-16`
- Modify: `src/commands/init.ts:214-218`
- Test: `test/profile-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/profile-defaults.test.ts`. First extend the `PROFILE` constant's `Default paths` YAML block to include the new keys — replace the existing `paths:` block inside `PROFILE` with:

```ts
const PROFILE = `# Profile: example

Some prose.

## Default paths (override in manifest)

\`\`\`yaml
paths:
  backend:
    - src/routes/**
    - src/services/**
  frontend: []
  tests:
    - tests/integration/**
  migrations:
    - prisma/**
  infra:
    - .github/workflows/**
  docs:
    - docs/**
\`\`\`

## Default commands (override in manifest)

\`\`\`yaml
commands:
  typecheck: pnpm typecheck
  lint: pnpm lint
  test: pnpm test
  acceptance: pnpm test:integration
\`\`\`
`;
```

Then add a test:

```ts
  test("extracts the new migrations/infra/docs path keys", () => {
    const d = parseProfileDefaults(PROFILE);
    expect(d.paths?.migrations).toEqual(["prisma/**"]);
    expect(d.paths?.infra).toEqual([".github/workflows/**"]);
    expect(d.paths?.docs).toEqual(["docs/**"]);
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm test -- profile-defaults`
Note: like Task 1, this test likely **passes already** at runtime (the YAML is parsed untyped, so `d.paths.migrations` returns the value; Vitest erases types). That is expected — it is a regression guard. The forcing function for the type change is Step 4 below: `init.ts`'s `composeManifest` loop indexes `args.paths[key]` for `key` including `"migrations"`, which fails `tsc` until `ProfileDefaults.paths` has the key. Proceed.

- [ ] **Step 3: Add the keys to the `ProfileDefaults` type**

In `src/util/profile-defaults.ts`, replace the `paths?` shape:

```ts
  paths?: {
    backend?: string[];
    frontend?: string[];
    shared?: string[];
    forbidden?: string[];
    tests?: string[];
    migrations?: string[];
    infra?: string[];
    docs?: string[];
  };
```

- [ ] **Step 4: Make `init` compose the new keys**

In `src/commands/init.ts`, in `composeManifest`, change the path-key loop:

```ts
  for (const key of ["backend", "frontend", "shared", "tests", "forbidden", "migrations", "infra", "docs"] as const) {
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm test -- profile-defaults && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/util/profile-defaults.ts src/commands/init.ts test/profile-defaults.test.ts
git commit -m "feat(init): parse and compose migrations/infra/docs path defaults"
```

---

## Task 4: Replace the forbidden-only guard with a config-driven scope guard

This task rewrites the guard internals in `claude-code.ts` so one script + one JSON config serve both the session-level forbidden net and per-agent allow-lists. Per-agent **wiring** (frontmatter hooks) comes in Task 5.

**Files:**
- Modify: `src/platforms/claude-code.ts` (imports, the `// 4.` call site, the guard section lines 122-270)
- Test: `test/guard.test.ts`

- [ ] **Step 1: Update imports and the agent-key map**

In `src/platforms/claude-code.ts`, change the fs import line and add the `Paths` import + agent-key map. Replace line 1:

```ts
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
```

Replace line 3:

```ts
import type { Manifest, Paths } from "../manifest.js";
```

Add this constant just below `DESCRIPTIONS_BY_AGENT` (after line 35):

```ts
// Editing agent -> the manifest path-list key it is allowed to edit. Read-only
// agents are absent (they have no edit tools). `shared` is read-only context and
// is intentionally not an allow-list.
const ALLOW_KEY_BY_AGENT: Record<string, keyof Paths> = {
  "backend-builder": "backend",
  "frontend-builder": "frontend",
  "test-verifier": "tests",
  "migration-author": "migrations",
  "devops-builder": "infra",
  "doc-writer": "docs",
};
```

- [ ] **Step 2: Swap the call site**

Replace the `// 4. Path guard …` comment + `writeForbiddenGuard(...)` call (lines 88-91) with:

```ts
    // 4. Path guard — enforces forbidden (session-wide) and per-agent allow-lists
    //    at the tool level. Frontmatter can't scope paths, so a PreToolUse hook does.
    writeScopeGuard(targetRoot, manifest, filesWritten);
```

- [ ] **Step 3: Replace the guard section**

Replace the entire block from `/* ------- Path guard (PreToolUse hook) ------- */` (line 122) through the end of `guardScript` (line 270) with the following. Keep `writeFile`, `extractDescription`, and everything above line 122 unchanged.

```ts
/* ------- Path guard (PreToolUse hooks) ------- */

const GUARD_REL_PATH = ".claude/hooks/factory-guard.mjs";
const SCOPE_CONFIG_REL_PATH = ".claude/hooks/factory-scope.json";
const SETTINGS_REL_PATH = ".claude/settings.json";
const GUARD_MARKER = "factory-guard.mjs";

interface ScopeConfig {
  forbidden: string[];
  agents: Record<string, string[]>;
}

/** Agents whose allow-list is PRESENT in the manifest (empty list counts as present). */
function agentAllowMap(manifest: Manifest): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [agent, key] of Object.entries(ALLOW_KEY_BY_AGENT)) {
    const list = manifest.paths[key];
    if (list !== undefined) map[agent] = list;
  }
  return map;
}

function scopeConfig(manifest: Manifest): ScopeConfig {
  return { forbidden: manifest.paths.forbidden ?? [], agents: agentAllowMap(manifest) };
}

/**
 * Write (or remove) the scope guard. Emits the script + config when there is
 * anything to enforce (forbidden non-empty OR any agent allow-list present).
 * The session-level settings.json hook is added only when forbidden is non-empty;
 * allow-lists are wired per-agent (Task 5), not at session level.
 */
function writeScopeGuard(targetRoot: string, manifest: Manifest, filesWritten: string[]): void {
  const config = scopeConfig(manifest);
  const hasForbidden = config.forbidden.length > 0;
  const hasAgents = Object.keys(config.agents).length > 0;

  const settingsPath = join(targetRoot, SETTINGS_REL_PATH);
  const scriptPath = join(targetRoot, GUARD_REL_PATH);
  const configPath = join(targetRoot, SCOPE_CONFIG_REL_PATH);

  if (!hasForbidden && !hasAgents) {
    if (removeIfExists(configPath)) filesWritten.push(configPath);
    if (removeIfExists(scriptPath)) filesWritten.push(scriptPath);
    if (removeGuardFromSettings(settingsPath)) filesWritten.push(settingsPath);
    return;
  }

  writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  filesWritten.push(configPath);
  writeFile(scriptPath, guardScript());
  filesWritten.push(scriptPath);

  if (hasForbidden) {
    mergeGuardIntoSettings(settingsPath);
    filesWritten.push(settingsPath);
  } else if (removeGuardFromSettings(settingsPath)) {
    filesWritten.push(settingsPath);
  }
}

function removeIfExists(path: string): boolean {
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

interface HookCommand {
  type: string;
  command: string;
}
interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
}

function isOurHook(entry: HookEntry): boolean {
  return (entry.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(GUARD_MARKER));
}

function readSettings(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mergeGuardIntoSettings(settingsPath: string): void {
  const settings = readSettings(settingsPath);
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  const preToolUse = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];

  const others = preToolUse.filter((e) => !isOurHook(e));
  others.push({
    matcher: "Write|Edit|MultiEdit|NotebookEdit",
    hooks: [{ type: "command", command: `node "$CLAUDE_PROJECT_DIR/${GUARD_REL_PATH}"` }],
  });

  hooks.PreToolUse = others;
  settings.hooks = hooks;
  writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

/** Returns true if it modified the file. */
function removeGuardFromSettings(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return false;
  const settings = readSettings(settingsPath);
  const hooks = settings.hooks as Record<string, HookEntry[]> | undefined;
  if (!hooks || !Array.isArray(hooks.PreToolUse)) return false;

  const kept = hooks.PreToolUse.filter((e) => !isOurHook(e));
  if (kept.length === hooks.PreToolUse.length) return false;

  if (kept.length > 0) hooks.PreToolUse = kept;
  else delete hooks.PreToolUse;
  if (Object.keys(hooks).length === 0) delete settings.hooks;

  writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

function guardScript(): string {
  return `#!/usr/bin/env node
// Generated by ai-factory. PreToolUse path guard.
// Reads factory-scope.json (next to this file):
//   { "forbidden": [globs], "agents": { "<agent>": [allow globs] } }
// Usage: node factory-guard.mjs [agentName]
//   - always blocks edits matching a forbidden glob (relative path or basename)
//   - if agentName has an allow-list, blocks edits whose relative path matches none of it
// Do not hand-edit — edit .factory.yaml and re-run \`factory install\`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let config = { forbidden: [], agents: {} };
try { config = JSON.parse(readFileSync(join(here, "factory-scope.json"), "utf8")); } catch {}

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^\${}()|[]\\\\".includes(c)) {
      re += "\\\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

const agentName = process.argv[2] || "";
const forbidden = (config.forbidden || []).map((g) => ({ g, re: globToRegExp(g) }));
const allowGlobs = agentName && config.agents && config.agents[agentName] ? config.agents[agentName] : null;
const allow = allowGlobs ? allowGlobs.map((g) => ({ g, re: globToRegExp(g) })) : null;

let raw = "";
try { raw = readFileSync(0, "utf8"); } catch {}
let data = {};
try { data = JSON.parse(raw || "{}"); } catch {}

const ti = data.tool_input || {};
const filePath = ti.file_path || ti.notebook_path || ti.path || "";
if (!filePath) process.exit(0);

const cwd = data.cwd || process.cwd();
let rel = filePath;
if (rel.startsWith(cwd)) rel = rel.slice(cwd.length);
rel = rel.replace(/^[/\\\\]+/, "");
const base = rel.split(/[/\\\\]/).pop() || rel;

for (const f of forbidden) {
  if (f.re.test(rel) || f.re.test(base)) {
    console.error('Blocked by ai-factory path guard: "' + rel + '" matches forbidden pattern "' + f.g + '" (CLAUDE.md -> "All agents must NOT edit"). Edit .factory.yaml and re-run factory install if this is intentional.');
    process.exit(2);
  }
}

if (allow !== null) {
  const ok = allow.some((a) => a.re.test(rel));
  if (!ok) {
    const list = allow.map((a) => a.g).join(", ") || "(none)";
    console.error('Blocked by ai-factory path guard: "' + rel + '" is outside ' + agentName + ' allowed paths [' + list + '] (CLAUDE.md -> "Path scoping for agents"). Edit .factory.yaml and re-run factory install if this is intentional.');
    process.exit(2);
  }
}

process.exit(0);
`;
}
```

- [ ] **Step 4: Update `test/guard.test.ts` for the new shape**

The existing helper builds `paths: { backend: ["src/**"], forbidden }` — so `backend` is always present. Replace the whole `manifest()` helper and the "generation" describe block so the emit-condition tests are explicit. Replace the `manifest(forbidden)` function with one that takes the full paths object:

```ts
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
```

Replace the `describe("path guard generation", …)` block with:

```ts
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
```

In the `describe("path guard behavior", …)` block, replace its `beforeEach` call `await generate([".env*", …])` with `await generate({ forbidden: [".env*", "**/secrets.*", "src/legacy/**"] })`.

In the `describe("settings.json merge", …)` block, replace every `await generate([".env*"])` with `await generate({ forbidden: [".env*"] })`, and replace `await generate([])` (the toggle-off test) with `await generate({})`.

- [ ] **Step 5: Add per-agent allow-list behavior tests**

Add a new describe block to `test/guard.test.ts`:

```ts
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
    // .env* is forbidden globally; even with an agent arg it is blocked.
    expect(runGuardAs("backend-builder", join(target, "src/.env"))).toBe(2);
  });

  test("an agent with no list (opt-in absent) is not allow-list enforced", () => {
    // frontend has no list in this manifest → only forbidden applies.
    expect(runGuardAs("frontend-builder", join(target, "anywhere/x.ts"))).toBe(0);
  });
});
```

- [ ] **Step 6: Run the guard tests**

Run: `pnpm test -- guard && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/platforms/claude-code.ts test/guard.test.ts
git commit -m "feat(claude-code): config-driven scope guard (forbidden + per-agent allow)"
```

---

## Task 5: Emit per-agent frontmatter hooks

**Files:**
- Modify: `src/platforms/claude-code.ts` (agent generation loop, lines 59-76)
- Test: `test/adapters.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/adapters.test.ts` inside `describe("claude-code adapter", …)`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- adapters`
Expected: FAIL — `backend-builder.md` has no `hooks:`.

- [ ] **Step 3: Add `agentHooksBlock` and wire it into the loop**

In `src/platforms/claude-code.ts`, add this helper just below `agentAllowMap` (or anywhere in the guard section):

```ts
/** Frontmatter `hooks:` lines for an editing agent whose allow-list is present; [] otherwise. */
function agentHooksBlock(agentName: string, manifest: Manifest): string[] {
  const key = ALLOW_KEY_BY_AGENT[agentName];
  if (!key || manifest.paths[key] === undefined) return [];
  return [
    "hooks:",
    "  PreToolUse:",
    '    - matcher: "Write|Edit|MultiEdit|NotebookEdit"',
    "      hooks:",
    "        - type: command",
    `          command: 'node "$CLAUDE_PROJECT_DIR/${GUARD_REL_PATH}" ${agentName}'`,
  ];
}
```

Then in the agent loop (lines 59-76), change the `file` assembly to splice the hooks block in before the closing `---`:

```ts
    for (const agent of agents) {
      const tools = TOOLS_BY_AGENT[agent.name] ?? "Read";
      const description = DESCRIPTIONS_BY_AGENT[agent.name] ?? `${agent.name} agent.`;
      const body = render(agent.body, platformVars);
      const file = [
        "---",
        `name: ${agent.name}`,
        `description: ${description}`,
        `tools: ${tools}`,
        ...agentHooksBlock(agent.name, manifest),
        "---",
        "",
        body.trim(),
        "",
      ].join("\n");
      const path = join(targetRoot, ".claude", "agents", `${agent.name}.md`);
      writeFile(path, file);
      filesWritten.push(path);
    }
```

- [ ] **Step 4: Fix the file-count assertion**

In `test/adapters.test.ts`, the "writes CLAUDE.md + one file per agent + one SKILL.md per skill" test now also writes `factory-scope.json`. Update the count from `+ 2` to `+ 3`:

```ts
    // CLAUDE.md + agents + skills + scope config + guard script + settings.json
    expect(res.filesWritten.length).toBe(1 + agents.length + skills.length + 3);
```

- [ ] **Step 5: Verify generated YAML frontmatter parses**

Add to `test/adapters.test.ts` inside `describe("claude-code adapter", …)`:

```ts
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
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test -- adapters && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/platforms/claude-code.ts test/adapters.test.ts
git commit -m "feat(claude-code): per-agent PreToolUse hook wiring for allow-lists"
```

---

## Task 6: Add migrations/infra/docs defaults to profiles

These are reference defaults parsed by `factory init` (additive — existing keys unchanged, overlaps are harmless). Add the three keys to each profile's `## Default paths` YAML block, after the existing keys and before the closing fence.

**Files:** Modify each `profiles/<name>.md` `Default paths` block.

- [ ] **Step 1: Edit each profile**

For each profile, insert these lines inside the `paths:` YAML block (matching the block's indentation):

`profiles/node-fastify.md`, `profiles/bun-hono.md`:
```yaml
  migrations:
    - prisma/**
    - drizzle/**
  infra:
    - Dockerfile
    - docker-compose*.yml
    - .github/workflows/**
  docs:
    - docs/**
    - CHANGELOG.md
    - README.md
```

`profiles/go-echo.md`:
```yaml
  migrations:
    - migrations/**
  infra:
    - Dockerfile
    - .github/workflows/**
  docs:
    - docs/**
    - CHANGELOG.md
    - README.md
```

`profiles/python-fastapi.md`:
```yaml
  migrations:
    - alembic/**
    - migrations/**
  infra:
    - Dockerfile
    - .github/workflows/**
  docs:
    - docs/**
    - CHANGELOG.md
    - README.md
```

`profiles/quarkus-reactive.md`:
```yaml
  migrations:
    - src/main/resources/db/**
  infra:
    - Dockerfile
    - .github/workflows/**
  docs:
    - docs/**
    - CHANGELOG.md
    - README.md
```

`profiles/python-library.md`:
```yaml
  infra:
    - .github/workflows/**
  docs:
    - docs/**
    - CHANGELOG.md
    - README.md
```
(No `migrations` — a library has no schema.)

`profiles/nextjs-app-router.md`, `profiles/react-vite.md`, `profiles/react-rsbuild-microfrontend.md`:
```yaml
  infra:
    - .github/workflows/**
    - Dockerfile
  docs:
    - docs/**
    - CHANGELOG.md
    - README.md
```
(No `migrations` for frontend profiles.)

- [ ] **Step 2: Verify each block still parses**

Run:
```bash
npx tsx -e "
import { readFileSync, readdirSync } from 'node:fs';
import { parseProfileDefaults } from './src/util/profile-defaults.ts';
for (const f of readdirSync('profiles').filter((f) => f.endsWith('.md'))) {
  const d = parseProfileDefaults(readFileSync('profiles/' + f, 'utf8'));
  console.log(f, 'docs=', JSON.stringify(d.paths?.docs ?? null));
}
"
```
Expected: every profile prints a non-null `docs=[...]` array and no parse error is thrown.

- [ ] **Step 3: Commit**

```bash
git add profiles/
git commit -m "feat(profiles): add migrations/infra/docs path defaults"
```

---

## Task 7: Document the feature in the README

**Files:** Modify `README.md` (the `.factory.yaml` example `paths:` block, and a short enforcement note).

- [ ] **Step 1: Extend the manifest example**

In `README.md`, in the `paths:` example block (around lines 182-193), add the three keys with comments after `frontend:` and before `shared:`:

```yaml
  migrations:                              # Migration Author may edit
    - prisma/**
  infra:                                   # DevOps Builder may edit
    - .github/workflows/**
  docs:                                    # Doc Writer may edit
    - docs/**
    - CHANGELOG.md
```

- [ ] **Step 2: Add an enforcement note**

In `README.md`, under the "How adapters work" section (or just after the path-scoping example), add:

```markdown
### Enforced path scoping (Claude Code)

On Claude Code, path scoping is **enforced**, not just advised:

- The `forbidden:` list is blocked session-wide by a `PreToolUse` hook
  (`.claude/hooks/factory-guard.mjs` + a merged `.claude/settings.json`).
- Each editing agent (`backend`, `frontend`, `tests`, `migrations`, `infra`,
  `docs`) gets a per-agent `PreToolUse` hook in its frontmatter that blocks
  edits outside its allow-list. Lists are **opt-in**: an agent with no list in
  the manifest is unenforced (prompt-only); an empty list means "edit nothing".

Limitations: enforcement covers `Write`/`Edit`/`MultiEdit`/`NotebookEdit` only —
a builder's `Bash` access can still write files, so the guard is a guardrail, not
a sandbox. Kiro and Codex have no hook mechanism, so they remain prompt-only.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document enforced per-agent path scoping"
```

---

## Task 8: Full verification + end-to-end smoke test

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit`
Expected: all test files pass; typecheck clean.

- [ ] **Step 2: End-to-end smoke test**

Run:
```bash
TMP=$(mktemp -d)
cat > "$TMP/.factory.yaml" <<'EOF'
name: demo
layer: backend
profile: node-fastify
commands: {typecheck: tc, lint: ln, test: ts}
paths:
  backend: [src/**]
  docs: [docs/**]
  forbidden: [".env*"]
platforms: [claude-code]
EOF
npx tsx src/cli.ts install --target "$TMP" >/dev/null 2>&1

# scope config + script exist
test -f "$TMP/.claude/hooks/factory-scope.json" && echo "config ✓"
# backend-builder has a hook, doc-writer has one too (docs present), researcher does not
grep -q 'factory-guard.mjs" backend-builder' "$TMP/.claude/agents/backend-builder.md" && echo "backend hook ✓"
grep -q 'factory-guard.mjs" doc-writer' "$TMP/.claude/agents/doc-writer.md" && echo "doc hook ✓"
grep -q 'hooks:' "$TMP/.claude/agents/researcher.md" && echo "BUG: researcher has a hook" || echo "researcher clean ✓"

# guard blocks doc-writer editing src, allows backend-builder editing src
G="$TMP/.claude/hooks/factory-guard.mjs"
echo "{\"cwd\":\"$TMP\",\"tool_input\":{\"file_path\":\"$TMP/src/x.ts\"}}" | node "$G" doc-writer; echo "  doc-writer→src expect 2, got $?"
echo "{\"cwd\":\"$TMP\",\"tool_input\":{\"file_path\":\"$TMP/src/x.ts\"}}" | node "$G" backend-builder; echo "  backend→src expect 0, got $?"
rm -rf "$TMP"
```
Expected: `config ✓`, `backend hook ✓`, `doc hook ✓`, `researcher clean ✓`, `doc-writer→src ... got 2`, `backend→src ... got 0`.

- [ ] **Step 3: Final commit (if any verification fix was needed)**

If steps 1-2 surfaced a fix, commit it; otherwise nothing to do.

```bash
git status --short
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** schema (T1), render (T2), init/defaults (T3), config-driven guard + forbidden + opt-in (T4), per-agent hooks (T5), profiles (T6), docs (T7), verification (T8). All spec sections mapped.
- **Type consistency:** `ALLOW_KEY_BY_AGENT` (T4) is used by both `agentAllowMap` (T4) and `agentHooksBlock` (T5). `GUARD_REL_PATH`/`SCOPE_CONFIG_REL_PATH`/`GUARD_MARKER` constants are defined once in T4 and reused in T5. The guard script reads `factory-scope.json` written by `writeScopeGuard`.
- **Backward compatibility:** absent list → no hook, no agent entry in config; existing manifests gain enforcement only for keys they already have (`backend/frontend/tests`).
