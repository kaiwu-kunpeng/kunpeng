import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { liveModuleStatuses } from "../src/evolution/live-module-status.js";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-livemod-"));
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t");
  await g.addConfig("user.name", "t");
  writeFileSync(join(repo, "README.md"), "x\n");
  await g.add(".");
  await g.commit("init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("liveModuleStatuses 返回 ModuleStatus[] 数组,绝不抛(即便 repo 不完整)", async () => {
  const out = await liveModuleStatuses(repo);
  expect(Array.isArray(out)).toBe(true);
  expect(out.length).toBeGreaterThan(0);
  for (const m of out) {
    expect(typeof m.id).toBe("string");
    expect(["green", "yellow", "red", "idle"]).toContain(m.light);
    expect(typeof m.wired).toBe("boolean");
  }
});

test("不存在的 repo 路径也只返回 []、不抛", async () => {
  const out = await liveModuleStatuses(join(repo, "no-such-subdir-xyz"));
  expect(Array.isArray(out)).toBe(true);
});
