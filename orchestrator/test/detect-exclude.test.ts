import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectChecks } from "../src/project/detect.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-detect-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function pkg(scripts: Record<string, string>): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts }, null, 2));
}

test("vitest 项目:test 检查排除 *.e2e 与 *.integration", async () => {
  pkg({ test: "vitest run", typecheck: "tsc --noEmit" });
  const checks = await detectChecks(dir);
  expect(checks.test).toBeTruthy();
  expect(checks.test).toContain("npm test");
  expect(checks.test).toContain("--exclude");
  expect(checks.test).toContain("*.e2e.test.ts");
  expect(checks.test).toContain("*.integration.test.ts");
  // typecheck 不受影响
  expect(checks.typecheck).toContain("npm run typecheck");
});

test("非 vitest(jest)项目:test 检查保持原样、不加 --exclude", async () => {
  pkg({ test: "jest" });
  const checks = await detectChecks(dir);
  expect(checks.test).toContain("npm test");
  expect(checks.test).not.toContain("--exclude");
});

test("无 test 脚本:checks.test 未定义", async () => {
  pkg({ build: "tsc" });
  const checks = await detectChecks(dir);
  expect(checks.test).toBeUndefined();
});
