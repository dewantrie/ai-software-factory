import { describe, test, expect } from "vitest";
import { parseProfileDefaults } from "../src/util/profile-defaults.js";

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

describe("parseProfileDefaults", () => {
  test("extracts commands from the Default commands block", () => {
    const d = parseProfileDefaults(PROFILE);
    expect(d.commands).toEqual({
      typecheck: "pnpm typecheck",
      lint: "pnpm lint",
      test: "pnpm test",
      acceptance: "pnpm test:integration",
    });
  });

  test("extracts paths from the Default paths block", () => {
    const d = parseProfileDefaults(PROFILE);
    expect(d.paths?.backend).toEqual(["src/routes/**", "src/services/**"]);
    expect(d.paths?.frontend).toEqual([]);
    expect(d.paths?.tests).toEqual(["tests/integration/**"]);
  });

  test("returns undefined sections when headers are missing", () => {
    const d = parseProfileDefaults("# Profile with no default blocks\n\nJust prose.");
    expect(d.commands).toBeUndefined();
    expect(d.paths).toBeUndefined();
  });

  test("accepts a ```yml fence as well as ```yaml", () => {
    const body = "## Default commands\n\n```yml\ncommands:\n  test: go test ./...\n```\n";
    const d = parseProfileDefaults(body);
    expect(d.commands?.test).toBe("go test ./...");
  });

  test("returns undefined for a section with malformed yaml", () => {
    const body = "## Default commands\n\n```yaml\ncommands: [unterminated\n```\n";
    const d = parseProfileDefaults(body);
    expect(d.commands).toBeUndefined();
  });

  test("extracts the new migrations/infra/docs path keys", () => {
    const d = parseProfileDefaults(PROFILE);
    expect(d.paths?.migrations).toEqual(["prisma/**"]);
    expect(d.paths?.infra).toEqual([".github/workflows/**"]);
    expect(d.paths?.docs).toEqual(["docs/**"]);
  });

  test("ignores a code block that is not immediately tied to a known header", () => {
    const body = "## Something else\n\n```yaml\ncommands:\n  test: nope\n```\n";
    const d = parseProfileDefaults(body);
    expect(d.commands).toBeUndefined();
  });
});
