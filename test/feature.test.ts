import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { featureStart, featureShip } from "../src/commands/feature.js";
import { loadStatus, featureDir } from "../src/util/contracts.js";

let root: string;
let contracts: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "factory-feature-"));
  contracts = join(root, "contracts");
  repo = join(root, "billing-api");
  // both dirs exist
  mkdirSync(contracts, { recursive: true });
  mkdirSync(repo, { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("featureStart", () => {
  test("scaffolds story.md (template) + status.yaml", async () => {
    await featureStart("invoice-reminders", { contractsRepo: contracts, cwd: repo });
    const dir = featureDir(contracts, "invoice-reminders");
    expect(existsSync(join(dir, "story.md"))).toBe(true);
    const story = readFileSync(join(dir, "story.md"), "utf8");
    expect(story).toContain("## User Story");
    expect(story).toContain("## Acceptance Criteria");

    const status = loadStatus(contracts, "invoice-reminders");
    expect(status.feature).toBe("invoice-reminders");
    expect(status.shipped).toEqual([]);
    expect(status.created).toBeTruthy();
  });

  test("seeds story.md from --from and warns on missing sections", async () => {
    const src = join(repo, "pm-story.md");
    writeFileSync(src, "# Just a title\n\nNo structured sections here.\n");
    const warnSpy = vi.spyOn(console, "warn");
    await featureStart("x", { contractsRepo: contracts, cwd: repo, from: src });
    const story = readFileSync(join(featureDir(contracts, "x"), "story.md"), "utf8");
    expect(story).toContain("No structured sections here.");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("refuses to overwrite an existing feature", async () => {
    await featureStart("dup", { contractsRepo: contracts, cwd: repo });
    await expect(featureStart("dup", { contractsRepo: contracts, cwd: repo })).rejects.toThrow(
      /already exists/,
    );
  });

  test("a missing --from file does not leave a half-created feature", async () => {
    await expect(
      featureStart("ghost", { contractsRepo: contracts, cwd: repo, from: join(repo, "nope.md") }),
    ).rejects.toThrow(/--from file not found/);
    expect(existsSync(featureDir(contracts, "ghost"))).toBe(false);
  });
});

describe("featureShip", () => {
  test("records this repo in status.shipped using explicit identity", async () => {
    await featureStart("f", { contractsRepo: contracts, cwd: repo });
    await featureShip("f", {
      contractsRepo: contracts,
      cwd: repo,
      repoName: "billing-api",
      layer: "backend",
      commit: "deadbeef",
    });

    const status = loadStatus(contracts, "f");
    expect(status.shipped).toHaveLength(1);
    expect(status.shipped[0]).toMatchObject({ name: "billing-api", layer: "backend", commit: "deadbeef" });
  });

  test("re-shipping the same repo updates in place (no duplicate)", async () => {
    await featureStart("f", { contractsRepo: contracts, cwd: repo });
    const ship = () =>
      featureShip("f", { contractsRepo: contracts, cwd: repo, repoName: "billing-api", layer: "backend" });
    await ship();
    await ship();
    expect(loadStatus(contracts, "f").shipped).toHaveLength(1);
  });

  test("copies a contract artifact into the feature dir as api.<ext>", async () => {
    await featureStart("f", { contractsRepo: contracts, cwd: repo });
    const contractFile = join(repo, "openapi.yaml");
    writeFileSync(contractFile, "openapi: 3.0.0\n");
    await featureShip("f", {
      contractsRepo: contracts,
      cwd: repo,
      repoName: "billing-api",
      layer: "backend",
      contract: contractFile,
    });
    expect(existsSync(join(featureDir(contracts, "f"), "api.yaml"))).toBe(true);
  });

  test("derives repo identity from the local manifest when not overridden", async () => {
    writeFileSync(join(repo, ".factory.yaml"), "name: from-manifest\nlayer: frontend\n");
    await featureStart("f", { contractsRepo: contracts, cwd: repo });
    await featureShip("f", { contractsRepo: contracts, cwd: repo });
    expect(loadStatus(contracts, "f").shipped[0]).toMatchObject({ name: "from-manifest", layer: "frontend" });
  });
});
