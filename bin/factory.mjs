#!/usr/bin/env node
// Global entry point for the `factory` CLI.
// Spawns tsx against the TypeScript source so users don't need a build step.
//
// Why: the CLI source lives in ../src/cli.ts. When installed globally via
// `pnpm link --global` (or `npm link`), this script becomes the user's
// `factory` binary. It locates tsx and the source relative to its own
// install dir — so the global symlink still works regardless of cwd.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");
const cliEntry = resolve(packageRoot, "src", "cli.ts");
const tsxBin = resolve(packageRoot, "node_modules", ".bin", "tsx");

const child = spawn(tsxBin, [cliEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("error", (err) => {
  console.error(`Failed to launch factory CLI: ${err.message}`);
  console.error(`Looked for tsx at: ${tsxBin}`);
  console.error(`If tsx is missing, run \`npm install\` (or \`pnpm install\`) in ${packageRoot}.`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
