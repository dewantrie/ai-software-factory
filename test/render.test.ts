import { describe, test, expect } from "vitest";
import { render, buildContextFile } from "../src/render.js";
import type { Manifest } from "../src/manifest.js";

describe("render", () => {
  test("substitutes a known variable", () => {
    expect(render("hello {{NAME}}", { NAME: "world" })).toBe("hello world");
  });

  test("substitutes the same variable multiple times", () => {
    expect(render("{{X}}-{{X}}", { X: "a" })).toBe("a-a");
  });

  test("leaves unknown variables untouched", () => {
    expect(render("{{KNOWN}} {{UNKNOWN}}", { KNOWN: "k" })).toBe("k {{UNKNOWN}}");
  });

  test("returns the body unchanged when there are no variables", () => {
    expect(render("plain text", { X: "y" })).toBe("plain text");
  });

  test("ignores non-word braces (no regex match)", () => {
    expect(render("{{ spaced }}", { spaced: "x" })).toBe("{{ spaced }}");
  });
});

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    name: "billing-api",
    layer: "backend",
    profile: "node-fastify",
    commands: { typecheck: "pnpm typecheck", lint: "pnpm lint", test: "pnpm test" },
    paths: {},
    platforms: ["claude-code"],
    ...overrides,
  };
}

describe("buildContextFile", () => {
  test("renders the standard sections in order", () => {
    const out = buildContextFile({
      manifest: baseManifest(),
      profileBody: "## Architecture rules\n\n- thin handlers",
      contextFileName: "CLAUDE.md",
      platform: "claude-code",
    });

    expect(out).toContain("# CLAUDE.md");
    expect(out).toContain("Profile: `node-fastify`");
    expect(out).toContain("## Repo identity");
    expect(out).toContain("- **Name:** billing-api");
    expect(out).toContain("- **Layer:** backend");
    expect(out).toContain("## Commands");
    expect(out).toContain("- Typecheck: `pnpm typecheck`");
    expect(out).toContain("## Profile rules");
    expect(out).toContain("- thin handlers");

    // Section order is stable
    expect(out.indexOf("## Repo identity")).toBeLessThan(out.indexOf("## Commands"));
    expect(out.indexOf("## Commands")).toBeLessThan(out.indexOf("## Path scoping for agents"));
    expect(out.indexOf("## Path scoping for agents")).toBeLessThan(out.indexOf("## Profile rules"));
  });

  test("honors a title override for the heading", () => {
    const out = buildContextFile({
      manifest: baseManifest(),
      profileBody: "",
      contextFileName: "AGENTS.md",
      title: "AGENTS.md — billing-api",
      platform: "codex",
    });
    expect(out.startsWith("# AGENTS.md — billing-api")).toBe(true);
  });

  test("omits the acceptance line when no acceptance command is set", () => {
    const out = buildContextFile({
      manifest: baseManifest(),
      profileBody: "",
      contextFileName: "CLAUDE.md",
      platform: "claude-code",
    });
    expect(out).not.toContain("- Acceptance:");
  });

  test("includes the acceptance line when present", () => {
    const out = buildContextFile({
      manifest: baseManifest({
        commands: { typecheck: "tc", lint: "ln", test: "ts", acceptance: "pnpm test:integration" },
      }),
      profileBody: "",
      contextFileName: "CLAUDE.md",
      platform: "claude-code",
    });
    expect(out).toContain("- Acceptance: `pnpm test:integration`");
  });

  test("renders path scoping blocks only for non-empty lists", () => {
    const out = buildContextFile({
      manifest: baseManifest({
        paths: { backend: ["src/**"], frontend: [], forbidden: [".env*"] },
      }),
      profileBody: "",
      contextFileName: "CLAUDE.md",
      platform: "claude-code",
    });
    expect(out).toContain("**Backend Builder may edit:**");
    expect(out).toContain("- `src/**`");
    expect(out).toContain("**All agents must NOT edit:**");
    expect(out).toContain("- `.env*`");
    // frontend is empty → no Frontend Builder block
    expect(out).not.toContain("**Frontend Builder may edit:**");
    // tests omitted entirely → no block
    expect(out).not.toContain("**Test Verifier may edit:**");
  });

  test("appends repo-specific don't-do when provided", () => {
    const out = buildContextFile({
      manifest: baseManifest({ dontDo: ["Do not call /v1"] }),
      profileBody: "",
      contextFileName: "CLAUDE.md",
      platform: "claude-code",
    });
    expect(out).toContain("## Repo-specific don't-do");
    expect(out).toContain("- Do not call /v1");
  });

  test("omits the don't-do section when the list is empty", () => {
    const out = buildContextFile({
      manifest: baseManifest({ dontDo: [] }),
      profileBody: "",
      contextFileName: "CLAUDE.md",
      platform: "claude-code",
    });
    expect(out).not.toContain("## Repo-specific don't-do");
  });

  test("appends free-form notes when provided", () => {
    const out = buildContextFile({
      manifest: baseManifest({ notes: "authoritative source for contracts" }),
      profileBody: "",
      contextFileName: "CLAUDE.md",
      platform: "claude-code",
    });
    expect(out).toContain("## Notes");
    expect(out).toContain("authoritative source for contracts");
  });
});
