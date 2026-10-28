import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFrontend } from "../src/project/detect.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-fe-det-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writePackage(target: string, pkg: unknown) {
  writeFileSync(join(target, "package.json"), JSON.stringify(pkg));
}

test("detects next dependencies as frontend", async () => {
  writePackage(dir, { dependencies: { next: "14" } });
  expect(await detectFrontend(dir)).toEqual({ isFrontend: true, framework: "next" });
});

test("prefers next over react", async () => {
  writePackage(dir, { dependencies: { next: "14", react: "18" } });
  expect(await detectFrontend(dir)).toEqual({ isFrontend: true, framework: "next" });
});

test("detects react dependencies as frontend", async () => {
  writePackage(dir, { dependencies: { react: "18" } });
  expect(await detectFrontend(dir)).toEqual({ isFrontend: true, framework: "react" });
});

test("detects vue dependencies as frontend", async () => {
  writePackage(dir, { dependencies: { vue: "3" } });
  expect(await detectFrontend(dir)).toEqual({ isFrontend: true, framework: "vue" });
});

test("detects vite devDependencies as frontend", async () => {
  writePackage(dir, { devDependencies: { vite: "5" } });
  expect(await detectFrontend(dir)).toEqual({ isFrontend: true, framework: "vite" });
});

test("does not mark backend-only dependencies as frontend", async () => {
  writePackage(dir, { dependencies: { express: "4" } });
  const result = await detectFrontend(dir);
  expect(result).toEqual({ isFrontend: false });
  expect(result).not.toHaveProperty("framework");
});

test("empty directory without package.json is not frontend", async () => {
  await expect(detectFrontend(dir)).resolves.toEqual({ isFrontend: false });
});

test("falls back to first matching one-level subpackage", async () => {
  mkdirSync(join(dir, "web"));
  writePackage(join(dir, "web"), { dependencies: { next: "14" } });
  expect(await detectFrontend(dir)).toEqual({ isFrontend: true, framework: "next" });
});
