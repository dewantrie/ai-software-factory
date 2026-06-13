import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest } from "../src/manifest.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-manifest-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeManifest(yaml: string): string {
  const p = join(dir, ".factory.yaml");
  writeFileSync(p, yaml);
  return p;
}

const VALID = `
name: billing-api
layer: backend
profile: node-fastify
commands:
  typecheck: pnpm typecheck
  lint: pnpm lint
  test: pnpm test
paths:
  backend:
    - src/**
platforms:
  - claude-code
`;

describe("loadManifest", () => {
  test("loads and normalizes a valid manifest", () => {
    const m = loadManifest(writeManifest(VALID));
    expect(m.name).toBe("billing-api");
    expect(m.layer).toBe("backend");
    expect(m.profile).toBe("node-fastify");
    expect(m.commands.test).toBe("pnpm test");
    expect(m.paths.backend).toEqual(["src/**"]);
    expect(m.platforms).toEqual(["claude-code"]);
  });

  test("maps kebab-case keys to camelCase fields", () => {
    const m = loadManifest(
      writeManifest(VALID + "\ncontracts-repo: ../contracts\nfactory-repo: /opt/factory\ndont-do:\n  - no v1\n"),
    );
    expect(m.contractsRepo).toBe("../contracts");
    expect(m.factoryRepo).toBe("/opt/factory");
    expect(m.dontDo).toEqual(["no v1"]);
  });

  test("defaults dontDo to an empty array when absent", () => {
    const m = loadManifest(writeManifest(VALID));
    expect(m.dontDo).toEqual([]);
  });

  test("defaults paths to an empty object when absent — but absence fails validation first", () => {
    // paths is a required key, so omitting it throws before normalization
    const yaml = VALID.replace(/paths:\n  backend:\n    - src\/\*\*\n/, "");
    expect(() => loadManifest(writeManifest(yaml))).toThrow(/missing required field: paths/);
  });

  test("throws when the file does not exist", () => {
    expect(() => loadManifest(join(dir, "nope.yaml"))).toThrow(/Manifest not found/);
  });

  test("throws on a missing required field", () => {
    const yaml = VALID.replace("profile: node-fastify\n", "");
    expect(() => loadManifest(writeManifest(yaml))).toThrow(/missing required field: profile/);
  });

  test("throws on an invalid layer", () => {
    const yaml = VALID.replace("layer: backend", "layer: serverless");
    expect(() => loadManifest(writeManifest(yaml))).toThrow(/invalid layer "serverless"/);
  });

  test("throws when a required command is missing (no silent undefined)", () => {
    const yaml = VALID.replace("  test: pnpm test\n", "");
    expect(() => loadManifest(writeManifest(yaml))).toThrow(/commands\.test must be a non-empty string/);
  });

  test("throws when a command is blank", () => {
    const yaml = VALID.replace("  lint: pnpm lint", '  lint: ""');
    expect(() => loadManifest(writeManifest(yaml))).toThrow(/commands\.lint must be a non-empty string/);
  });

  test("throws on an invalid platform", () => {
    const yaml = VALID.replace("  - claude-code", "  - vscode");
    expect(() => loadManifest(writeManifest(yaml))).toThrow(/invalid platform "vscode"/);
  });

  test("throws on an empty platforms list", () => {
    const yaml = VALID.replace("platforms:\n  - claude-code\n", "platforms: []\n");
    expect(() => loadManifest(writeManifest(yaml))).toThrow(/platforms must be a non-empty list/);
  });

  test.each(["backend", "frontend", "worker", "mobile", "fullstack"])(
    "accepts the valid layer %s",
    (layer) => {
      const yaml = VALID.replace("layer: backend", `layer: ${layer}`);
      expect(loadManifest(writeManifest(yaml)).layer).toBe(layer);
    },
  );

  test("loads the new migrations/infra/docs path keys", () => {
    const m = loadManifest(
      writeManifest(
        VALID.replace(
          "platforms:",
          "  migrations:\n    - prisma/**\n  infra:\n    - .github/workflows/**\n  docs:\n    - docs/**\nplatforms:",
        ),
      ),
    );
    expect(m.paths.migrations).toEqual(["prisma/**"]);
    expect(m.paths.infra).toEqual([".github/workflows/**"]);
    expect(m.paths.docs).toEqual(["docs/**"]);
  });
});
