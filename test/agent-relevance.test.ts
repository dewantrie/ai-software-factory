import { describe, test, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAgentRelevant, relevantAgents } from "../src/util/scope.js";
import { loadProfileMeta, loadProfile } from "../src/render.js";
import type { Manifest } from "../src/manifest.js";

// An editing agent is generated only when the manifest declares the paths it
// owns. Before this rule, a frontend-only repo shipped a `migration-author` for
// a database it did not have — and worse, that agent had no allow-list, so the
// guard fell through to the forbidden list alone and it could write anywhere.
// The agent nobody wanted was the least constrained one in the repo.

const FACTORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const base: Omit<Manifest, "paths"> = {
  name: "demo",
  layer: "frontend",
  profile: "react-vite",
  commands: { typecheck: "tc", lint: "ln", test: "ts" },
  platforms: ["claude-code"],
};
const withPaths = (paths: Manifest["paths"]): Manifest => ({ ...base, paths });

const AGENTS = [
  "researcher",
  "story-writer",
  "spec-writer",
  "validator",
  "security-reviewer",
  "performance-reviewer",
  "backend-builder",
  "frontend-builder",
  "test-verifier",
  "migration-author",
  "devops-builder",
  "doc-writer",
].map((name) => ({ name }));

describe("agent relevance", () => {
  test("read-only agents are always generated", () => {
    const m = withPaths({});
    for (const a of ["researcher", "story-writer", "spec-writer", "validator", "security-reviewer", "performance-reviewer"]) {
      expect(isAgentRelevant(a, m)).toBe(true);
    }
  });

  test("an editing agent needs its path key declared", () => {
    const m = withPaths({ frontend: ["src/**"], tests: ["src/**/*.test.tsx"] });
    expect(isAgentRelevant("frontend-builder", m)).toBe(true);
    expect(isAgentRelevant("test-verifier", m)).toBe(true);
    expect(isAgentRelevant("backend-builder", m)).toBe(false);
    expect(isAgentRelevant("migration-author", m)).toBe(false);
    expect(isAgentRelevant("devops-builder", m)).toBe(false);
    expect(isAgentRelevant("doc-writer", m)).toBe(false);
  });

  test("an empty list still generates the agent — it may edit nothing", () => {
    // Absent key and empty list mean different things (D6). The manifest keeps
    // the ability to say "this agent exists here and is scoped to nothing".
    expect(isAgentRelevant("frontend-builder", withPaths({ frontend: [] }))).toBe(true);
    expect(isAgentRelevant("frontend-builder", withPaths({}))).toBe(false);
  });

  test("a frontend-only repo generates no backend-side agents", () => {
    const names = relevantAgents(AGENTS, withPaths({ frontend: ["src/**"], forbidden: [".env*"] })).map((a) => a.name);
    expect(names).toContain("frontend-builder");
    expect(names).not.toContain("backend-builder");
    expect(names).not.toContain("migration-author");
    expect(names).not.toContain("devops-builder");
  });

  test("no editing agent is ever generated without an allow-list", () => {
    // The invariant that closes the hole: every generated editing agent has a
    // key in the manifest, therefore an entry in factory-scope.json.
    const m = withPaths({ backend: ["src/**"], docs: [] });
    for (const a of relevantAgents(AGENTS, m)) {
      const editing = ["backend-builder", "frontend-builder", "test-verifier", "migration-author", "devops-builder", "doc-writer"];
      if (editing.includes(a.name)) expect(isAgentRelevant(a.name, m)).toBe(true);
    }
    expect(relevantAgents(AGENTS, m).map((a) => a.name)).toEqual([
      "researcher", "story-writer", "spec-writer", "validator",
      "security-reviewer", "performance-reviewer", "backend-builder", "doc-writer",
    ]);
  });
});

describe("profile layer metadata", () => {
  const profiles = readdirSync(join(FACTORY_ROOT, "profiles"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));

  test("every profile declares at least one layer", () => {
    const missing = profiles.filter((p) => loadProfileMeta(FACTORY_ROOT, p).layers.length === 0);
    expect(missing).toEqual([]);
  });

  test("layers are drawn from the manifest's layer enum", () => {
    const valid = new Set(["backend", "frontend", "worker", "mobile", "fullstack"]);
    const bad: string[] = [];
    for (const p of profiles) {
      for (const l of loadProfileMeta(FACTORY_ROOT, p).layers) if (!valid.has(l)) bad.push(`${p} → ${l}`);
    }
    expect(bad).toEqual([]);
  });

  test("the frontmatter never reaches the generated context file", () => {
    for (const p of profiles) {
      const body = loadProfile(FACTORY_ROOT, p);
      expect(body.startsWith("---")).toBe(false);
      expect(body).not.toContain("layers:");
    }
  });

  test("a backend layer is not offered a frontend profile", () => {
    const forBackend = profiles.filter((p) => loadProfileMeta(FACTORY_ROOT, p).layers.includes("backend"));
    expect(forBackend).toContain("bun-hono");
    expect(forBackend).not.toContain("react-vite");
    expect(forBackend).not.toContain("react-rsbuild-microfrontend");
  });
});
