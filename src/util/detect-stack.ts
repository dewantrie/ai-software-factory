import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Layer } from "../manifest.js";

export interface DetectedStack {
  layer?: Layer;
  profile?: string;
  reason?: string;
}

/**
 * Best-effort detection of layer and profile from files in the repo root.
 * Returns undefined fields if it can't tell — the wizard falls back to asking.
 */
export function detectStack(targetRoot: string): DetectedStack {
  // Go
  if (existsSync(join(targetRoot, "go.mod"))) {
    return { layer: "backend", profile: "go-echo", reason: "go.mod present" };
  }

  // Python
  if (existsSync(join(targetRoot, "pyproject.toml")) || existsSync(join(targetRoot, "requirements.txt"))) {
    return { layer: "backend", profile: "python-fastapi", reason: "pyproject.toml / requirements.txt present" };
  }

  // Java — Quarkus (look for quarkus markers in Maven or Gradle build files)
  const javaBuildFiles = ["pom.xml", "build.gradle", "build.gradle.kts"];
  for (const f of javaBuildFiles) {
    const p = join(targetRoot, f);
    if (existsSync(p)) {
      try {
        if (readFileSync(p, "utf8").includes("quarkus")) {
          return { layer: "backend", profile: "quarkus-reactive", reason: `${f} mentions quarkus` };
        }
      } catch {
        // fall through
      }
    }
  }

  // Bun-flavored lockfile / config wins before generic Node
  const bunSignals =
    existsSync(join(targetRoot, "bun.lockb")) ||
    existsSync(join(targetRoot, "bunfig.toml"));

  // Node ecosystem
  const pkgPath = join(targetRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

      // Next.js
      if ("next" in deps) {
        return { layer: "fullstack", profile: "nextjs-app-router", reason: "next in dependencies" };
      }
      // Bun + Hono
      if ("hono" in deps || (bunSignals && !("fastify" in deps))) {
        return {
          layer: "backend",
          profile: "bun-hono",
          reason: "hono in dependencies" + (bunSignals ? " (+ Bun lockfile/config)" : ""),
        };
      }
      // Fastify backend
      if ("fastify" in deps) {
        return { layer: "backend", profile: "node-fastify", reason: "fastify in dependencies" };
      }
      // React (probably frontend)
      if ("react" in deps && !("express" in deps) && !("fastify" in deps)) {
        return { layer: "frontend", profile: "nextjs-app-router", reason: "react without backend deps" };
      }
      // Fallback Node backend
      return { layer: "backend", profile: "node-fastify", reason: "package.json present, no stack signal" };
    } catch {
      // fall through
    }
  }

  // Bun signals without package.json (rare but possible)
  if (bunSignals) {
    return { layer: "backend", profile: "bun-hono", reason: "Bun lockfile/config present" };
  }

  return {};
}
