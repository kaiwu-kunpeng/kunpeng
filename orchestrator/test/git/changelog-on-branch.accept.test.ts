import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { appendChangelogOnBranch } from "../../src/git/changelog-on-branch.js";

const CL = "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- 首版\n";
let repo: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-cl-branch-"));
  const g = simpleGit(repo);
  await g.init(); await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
  await g.checkoutLocalBranch("main");
  writeFileSync(join(repo, "CHANGELOG.md"), CL);
  writeFileSync(join(repo, "a.txt"), "base");
  await g.add("."); await g.commit("base");
  await g.checkoutLocalBranch("kp/f1");
  writeFileSync(join(repo, "b.txt"), "feat"); await g.add("b.txt"); await g.commit("feat");
  await g.checkout("main");
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

test("在流分支上追加一条提交：条目进 Unreleased 的分类小节，main 与主工作树不动（作者锁定）", async () => {
  const g = simpleGit(repo);
  const mainBefore = (await g.revparse(["main"])).trim();
  const branchBefore = (await g.revparse(["kp/f1"])).trim();
  const r = await appendChangelogOnBranch(repo, "kp/f1", { category: "Fixed", entry: "修复看板幽灵流（f1）" });
  expect(r.status).toBe("appended");
  expect((await g.revparse(["main"])).trim()).toBe(mainBefore);
  const branchAfter = (await g.revparse(["kp/f1"])).trim();
  expect(branchAfter).not.toBe(branchBefore);
  expect((await g.raw(["rev-parse", "kp/f1^"])).trim()).toBe(branchBefore);
  const cl = await g.show(["kp/f1:CHANGELOG.md"]);
  const unrel = cl.slice(cl.indexOf("## [Unreleased]"), cl.indexOf("## [1.0.0]"));
  expect(unrel).toContain("### Fixed\n- 修复看板幽灵流（f1）\n");
  expect(cl).toContain("## [1.0.0] - 2026-01-01\n\n### Added\n- 首版\n");
  const files = (await g.raw(["diff", "--name-only", branchBefore, branchAfter])).trim();
  expect(files).toBe("CHANGELOG.md");
  expect(await g.show(["main:CHANGELOG.md"])).toBe(CL);
  expect((await g.status()).isClean()).toBe(true);
  expect(existsSync(join(repo, ".kunpeng", "changelog-tmp"))).toBe(false);
});

test("同一条目再追加一次 → already-present，分支不再多提交", async () => {
  const g = simpleGit(repo);
  const item = { category: "Fixed" as const, entry: "修复看板幽灵流（f1）" };
  expect((await appendChangelogOnBranch(repo, "kp/f1", item)).status).toBe("appended");
  const once = (await g.revparse(["kp/f1"])).trim();
  expect((await appendChangelogOnBranch(repo, "kp/f1", item)).status).toBe("already-present");
  expect((await g.revparse(["kp/f1"])).trim()).toBe(once);
  const cl = await g.show(["kp/f1:CHANGELOG.md"]);
  expect(cl.split("修复看板幽灵流（f1）").length).toBe(2);
});

test("仓库根没有 CHANGELOG.md → no-changelog，分支不动", async () => {
  const g = simpleGit(repo);
  await g.checkout("kp/f1");
  await g.rm("CHANGELOG.md"); await g.commit("drop changelog");
  await g.checkout("main");
  const before = (await g.revparse(["kp/f1"])).trim();
  const r = await appendChangelogOnBranch(repo, "kp/f1", { category: "Added", entry: "x（f1）" });
  expect(r.status).toBe("no-changelog");
  expect((await g.revparse(["kp/f1"])).trim()).toBe(before);
});

test("分支不存在 → error，不抛异常", async () => {
  const r = await appendChangelogOnBranch(repo, "kp/nope", { category: "Added", entry: "x" });
  expect(r.status).toBe("error");
  expect(r.error ?? "").not.toBe("");
});