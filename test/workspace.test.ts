import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkspace } from "../src/util/workspace.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-workspace-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadWorkspace", () => {
  test("loads an explicit workspace file with string entries", () => {
    const p = join(dir, "ws.yaml");
    writeFileSync(p, "repos:\n  - ../a\n  - ../b\n");
    const ws = loadWorkspace(p, dir);
    expect(ws.path).toBe(p);
    expect(ws.repos).toEqual(["../a", "../b"]);
  });

  test("accepts object entries with a path field", () => {
    const p = join(dir, "ws.yaml");
    writeFileSync(p, "repos:\n  - path: ../a\n  - ../b\n");
    expect(loadWorkspace(p, dir).repos).toEqual(["../a", "../b"]);
  });

  test("falls back to <factory-root>/workspace.yaml", () => {
    const p = join(dir, "workspace.yaml");
    writeFileSync(p, "repos:\n  - ../only\n");
    const ws = loadWorkspace(undefined, dir);
    expect(ws.path).toBe(p);
    expect(ws.repos).toEqual(["../only"]);
  });

  test("throws a helpful error when no workspace file exists", () => {
    expect(() => loadWorkspace(undefined, dir)).toThrow(/No workspace file found/);
  });

  test("throws when repos is not a list", () => {
    const p = join(dir, "ws.yaml");
    writeFileSync(p, "repos: not-a-list\n");
    expect(() => loadWorkspace(p, dir)).toThrow(/must contain a top-level `repos` list/);
  });

  test("throws on an invalid repo entry", () => {
    const p = join(dir, "ws.yaml");
    writeFileSync(p, "repos:\n  - 42\n");
    expect(() => loadWorkspace(p, dir)).toThrow(/Invalid repo entry/);
  });
});
