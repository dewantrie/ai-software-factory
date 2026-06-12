import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectStack } from "../src/util/detect-stack.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-detect-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, content: string) {
  writeFileSync(join(dir, name), content);
}
function pkg(deps: Record<string, string>, dev: Record<string, string> = {}) {
  file("package.json", JSON.stringify({ dependencies: deps, devDependencies: dev }));
}

describe("detectStack", () => {
  test("go.mod → go-echo backend", () => {
    file("go.mod", "module example.com/x\n");
    expect(detectStack(dir)).toMatchObject({ layer: "backend", profile: "go-echo" });
  });

  test("pyproject.toml → python-fastapi backend", () => {
    file("pyproject.toml", "[project]\nname='x'\n");
    expect(detectStack(dir)).toMatchObject({ layer: "backend", profile: "python-fastapi" });
  });

  test("requirements.txt → python-fastapi backend", () => {
    file("requirements.txt", "fastapi\n");
    expect(detectStack(dir)).toMatchObject({ profile: "python-fastapi" });
  });

  test("pom.xml mentioning quarkus → quarkus-reactive", () => {
    file("pom.xml", "<project><dependency>io.quarkus</dependency></project>");
    expect(detectStack(dir)).toMatchObject({ layer: "backend", profile: "quarkus-reactive" });
  });

  test("next dependency → nextjs-app-router fullstack", () => {
    pkg({ next: "15", react: "19" });
    expect(detectStack(dir)).toMatchObject({ layer: "fullstack", profile: "nextjs-app-router" });
  });

  test("module federation + rsbuild → react-rsbuild-microfrontend", () => {
    pkg({ "@module-federation/enhanced": "0.6", "@rsbuild/core": "1.0", react: "19" });
    expect(detectStack(dir)).toMatchObject({ profile: "react-rsbuild-microfrontend", layer: "frontend" });
  });

  test("hono dependency → bun-hono backend", () => {
    pkg({ hono: "4" });
    expect(detectStack(dir)).toMatchObject({ layer: "backend", profile: "bun-hono" });
  });

  test("bun lockfile without fastify → bun-hono", () => {
    pkg({ something: "1" });
    file("bun.lockb", "");
    expect(detectStack(dir)).toMatchObject({ profile: "bun-hono" });
  });

  test("fastify dependency → node-fastify backend", () => {
    pkg({ fastify: "4" });
    expect(detectStack(dir)).toMatchObject({ layer: "backend", profile: "node-fastify" });
  });

  test("react + vite → react-vite frontend", () => {
    pkg({ react: "19", vite: "6" });
    expect(detectStack(dir)).toMatchObject({ layer: "frontend", profile: "react-vite" });
  });

  test("react without a bundler → react-vite frontend (default SPA)", () => {
    pkg({ react: "19" });
    expect(detectStack(dir)).toMatchObject({ layer: "frontend", profile: "react-vite" });
  });

  test("react alongside fastify is NOT treated as a frontend", () => {
    pkg({ react: "19", fastify: "4" });
    // fastify wins → backend
    expect(detectStack(dir)).toMatchObject({ layer: "backend", profile: "node-fastify" });
  });

  test("package.json with no stack signal → node-fastify fallback", () => {
    pkg({ lodash: "4" });
    expect(detectStack(dir)).toMatchObject({ layer: "backend", profile: "node-fastify" });
  });

  test("empty directory → no detection", () => {
    expect(detectStack(dir)).toEqual({});
  });

  test("malformed package.json → no detection (does not throw)", () => {
    file("package.json", "{ not json");
    expect(detectStack(dir)).toEqual({});
  });
});
