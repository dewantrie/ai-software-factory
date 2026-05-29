#!/usr/bin/env node
import { Command } from "commander";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { install } from "./commands/install.js";
import { init } from "./commands/init.js";
import { sync } from "./commands/sync.js";
import {
  featureStart,
  featurePull,
  featureShip,
  featureList,
  featureStatus,
} from "./commands/feature.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FACTORY_ROOT = resolve(__dirname, "..");

const program = new Command();

program
  .name("factory")
  .description("Central factory for the 7-agent software factory pattern.")
  .version("0.1.0");

program
  .command("install")
  .description("Generate platform files from .factory.yaml in the current directory.")
  .option("-m, --manifest <path>", "manifest file path", ".factory.yaml")
  .option("-f, --factory-root <path>", "path to ai-factory checkout", DEFAULT_FACTORY_ROOT)
  .option("-t, --target <path>", "target repo root (where to write files)", ".")
  .action(async (opts) => {
    await install({
      manifestPath: opts.manifest,
      factoryRoot: opts.factoryRoot,
      targetRoot: opts.target,
    });
  });

program
  .command("init")
  .description("Interactive: create a .factory.yaml manifest in the current directory.")
  .option("-t, --target <path>", "target repo root", ".")
  .option("-f, --factory-root <path>", "path to ai-factory checkout", DEFAULT_FACTORY_ROOT)
  .option("--force", "overwrite an existing .factory.yaml")
  .action(async (opts) => {
    await init({
      targetRoot: opts.target,
      factoryRoot: opts.factoryRoot,
      force: opts.force ?? false,
    });
  });

program
  .command("sync")
  .description("Re-run install for every repo listed in a workspace file.")
  .option("-w, --workspace <path>", "explicit workspace file path")
  .option("-f, --factory-root <path>", "path to ai-factory checkout", DEFAULT_FACTORY_ROOT)
  .option("--dry-run", "list what would be synced without writing files")
  .action(async (opts) => {
    await sync({
      workspacePath: opts.workspace,
      factoryRoot: opts.factoryRoot,
      dryRun: opts.dryRun ?? false,
    });
  });

const featureCmd = program
  .command("feature")
  .description("Cross-repo feature lifecycle (story + API contract bridge across repos).");

featureCmd
  .command("start <name>")
  .description("Create a feature scaffold (story.md + status.yaml) in the contracts repo.")
  .option("-c, --contracts-repo <path>", "override the contracts-repo path")
  .action(async (name, opts) => {
    await featureStart(name, {
      contractsRepo: opts.contractsRepo,
      cwd: process.cwd(),
    });
  });

featureCmd
  .command("pull <name>")
  .description("Copy a feature's story + contracts from the contracts repo into .factory/features/<name>/.")
  .option("-c, --contracts-repo <path>", "override the contracts-repo path")
  .action(async (name, opts) => {
    await featurePull(name, {
      contractsRepo: opts.contractsRepo,
      cwd: process.cwd(),
    });
  });

featureCmd
  .command("ship <name>")
  .description("Mark this repo as having shipped the feature; optionally copy a contract artifact back to the contracts repo.")
  .option("-c, --contracts-repo <path>", "override the contracts-repo path")
  .option("--contract <path>", "local path to an API contract file to copy into the contracts repo")
  .option("--commit <sha>", "record a commit SHA in status.yaml")
  .option("--repo-name <name>", "override the local repo name (defaults to manifest)")
  .option("--layer <layer>", "override the local layer (defaults to manifest)")
  .action(async (name, opts) => {
    await featureShip(name, {
      contractsRepo: opts.contractsRepo,
      cwd: process.cwd(),
      contract: opts.contract,
      commit: opts.commit,
      repoName: opts.repoName,
      layer: opts.layer,
    });
  });

featureCmd
  .command("list")
  .description("List all features in the contracts repo.")
  .option("-c, --contracts-repo <path>", "override the contracts-repo path")
  .action(async (opts) => {
    await featureList({
      contractsRepo: opts.contractsRepo,
      cwd: process.cwd(),
    });
  });

featureCmd
  .command("status <name>")
  .description("Show shipping status for a feature.")
  .option("-c, --contracts-repo <path>", "override the contracts-repo path")
  .action(async (name, opts) => {
    await featureStatus(name, {
      contractsRepo: opts.contractsRepo,
      cwd: process.cwd(),
    });
  });

program.parseAsync(process.argv);
