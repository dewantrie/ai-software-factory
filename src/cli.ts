#!/usr/bin/env node
import { Command } from "commander";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { install } from "./commands/install.js";

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
  .action(() => {
    console.log("`init` is not implemented yet. For now, copy examples/manifest-backend.yaml or manifest-frontend.yaml from the ai-factory repo and edit.");
    process.exit(1);
  });

program
  .command("sync")
  .description("Re-run install for all repos listed in a workspace manifest (not implemented yet).")
  .action(() => {
    console.log("`sync` is not implemented yet. Run `factory install` per repo for now.");
    process.exit(1);
  });

program.parseAsync(process.argv);
