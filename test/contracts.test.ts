import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolveContractsRepo,
  featureDir,
  statusPath,
  loadStatus,
  saveStatus,
  listFeatures,
  type FeatureStatus,
} from "../src/util/contracts.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-contracts-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveContractsRepo", () => {
  test("uses the explicit path resolved against cwd", () => {
    expect(resolveContractsRepo({ explicit: "../contracts", cwd: dir })).toBe(resolve(dir, "../contracts"));
  });

  test("reads contracts-repo from the local manifest, resolved relative to it", () => {
    writeFileSync(join(dir, ".factory.yaml"), "name: x\ncontracts-repo: ../shared-contracts\n");
    expect(resolveContractsRepo({ cwd: dir })).toBe(resolve(dir, "../shared-contracts"));
  });

  test("throws when no manifest and no explicit path", () => {
    expect(() => resolveContractsRepo({ cwd: dir })).toThrow(/No \.factory\.yaml/);
  });

  test("throws when manifest lacks a contracts-repo field", () => {
    writeFileSync(join(dir, ".factory.yaml"), "name: x\nlayer: backend\n");
    expect(() => resolveContractsRepo({ cwd: dir })).toThrow(/no `contracts-repo` field/);
  });
});

describe("status round-trip", () => {
  function seedFeature(name: string): void {
    mkdirSync(featureDir(dir, name), { recursive: true });
  }

  test("saveStatus then loadStatus returns the same data", () => {
    seedFeature("invoice-reminders");
    const status: FeatureStatus = {
      feature: "invoice-reminders",
      created: "2026-01-01T00:00:00.000Z",
      shipped: [
        { name: "billing-api", layer: "backend", shipped_at: "2026-01-02T00:00:00.000Z", commit: "abc123" },
      ],
    };
    saveStatus(dir, status);
    expect(loadStatus(dir, "invoice-reminders")).toEqual(status);
  });

  test("statusPath points inside the feature dir", () => {
    expect(statusPath(dir, "f")).toBe(join(dir, "features", "f", "status.yaml"));
  });

  test("loadStatus throws when the status file is absent", () => {
    expect(() => loadStatus(dir, "ghost")).toThrow(/Status file not found/);
  });

  test("loadStatus throws on malformed status (no shipped array)", () => {
    seedFeature("broken");
    writeFileSync(statusPath(dir, "broken"), "feature: broken\ncreated: now\n");
    expect(() => loadStatus(dir, "broken")).toThrow(/Malformed status\.yaml/);
  });
});

describe("listFeatures", () => {
  test("returns [] when the features dir does not exist", () => {
    expect(listFeatures(dir)).toEqual([]);
  });

  test("lists feature directories sorted, ignoring stray files", () => {
    mkdirSync(join(dir, "features", "b-feature"), { recursive: true });
    mkdirSync(join(dir, "features", "a-feature"), { recursive: true });
    writeFileSync(join(dir, "features", "README.md"), "not a feature");
    expect(listFeatures(dir)).toEqual(["a-feature", "b-feature"]);
  });
});
