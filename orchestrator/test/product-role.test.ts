import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { DEFAULT_PM_ROLE, loadRolePrompt } from "../src/product/role.js";

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-product-role-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("loadRolePrompt returns product-manager role file content when present", async () => {
  const repo = await makeRepo();
  const rosterDir = join(repo, "roster");
  await mkdir(rosterDir, { recursive: true });
  const roleContent = "自定义 PM 角色卡\n要求具体客户与具体场景。\n";
  await writeFile(join(rosterDir, "product-manager.role.md"), roleContent, "utf8");

  await expect(loadRolePrompt(repo, "product-manager")).resolves.toBe(roleContent);
});

test("loadRolePrompt falls back to default product-manager role", async () => {
  const repo = await makeRepo();

  await expect(loadRolePrompt(repo, "product-manager")).resolves.toBe(DEFAULT_PM_ROLE);
  expect(DEFAULT_PM_ROLE).not.toBe("");
  expect(DEFAULT_PM_ROLE).toContain("产品经理");
});

test("loadRolePrompt returns empty string for missing non-product role", async () => {
  const repo = await makeRepo();

  await expect(loadRolePrompt(repo, "nonexistent-role")).resolves.toBe("");
});
