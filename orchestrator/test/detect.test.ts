import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectChecks } from "../src/project/detect.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-det-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("detects typecheck/lint/build from package.json scripts", async () => {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc --noEmit", lint: "next lint", build: "next build" } }));
  const c = await detectChecks(dir);
  expect(c.typecheck).toBe("npm run typecheck");
  expect(c.lint).toBe("npm run lint");
  expect(c.build).toBe("npm run build");
});

test("falls back to npx --no-install tsc --noEmit when no typecheck script but tsconfig exists", async () => {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: {} }));
  writeFileSync(join(dir, "tsconfig.json"), "{}");
  const c = await detectChecks(dir);
  expect(c.typecheck).toBe("npx --no-install tsc --noEmit"); // --no-install: worktree 内只用软链的本地 tsc
  expect(c.lint).toBeUndefined();
});

test("falls back to a one-level subdir (子包如 orchestrator/) with cd 前缀", async () => {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, "orchestrator"));
  writeFileSync(join(dir, "orchestrator", "package.json"), JSON.stringify({ scripts: { typecheck: "tsc --noEmit", lint: "eslint ." } }));
  const c = await detectChecks(dir); // root 无 package.json → 探子目录
  expect(c.typecheck).toBe("cd orchestrator && npm run typecheck");
  expect(c.lint).toBe("cd orchestrator && npm run lint");
});

test("no package.json → empty checks (degrades gracefully)", async () => {
  expect(await detectChecks(dir)).toEqual({});
});
