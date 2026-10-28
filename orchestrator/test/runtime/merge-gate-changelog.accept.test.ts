import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { mergeAndClearGate } from "../../src/runtime/merge-gate.js";

const CL = "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- 首版\n";
const GREEN = { guardTests: async () => ({ status: "green" as const, summary: "绿", durationMs: 1 }) };
let repo: string;
let prevState: string | undefined;
let prevInstance: string | undefined;

async function makeFlow(id: string, file: string, requirement: string): Promise<void> {
  const g = simpleGit(repo);
  await g.checkoutLocalBranch(`kp/${id}`);
  writeFileSync(join(repo, file), id); await g.add(file); await g.commit(`feat ${id}`);
  await g.checkout("main");
  const t = new FlowTracker(join(repo, ".kunpeng", "state"));
  await t.start(id, requirement);
  await t.finish(id, "verified", { gate: "合并主干 (人工门#1)", what: `kp/${id} → main` });
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-mg-cl-"));
  prevState = process.env.KUNPENG_STATE;
  prevInstance = process.env.KUNPENG_INSTANCE;
  process.env.KUNPENG_STATE = join(repo, "global-state");
  process.env.KUNPENG_INSTANCE = "merge-changelog-test";
  const g = simpleGit(repo);
  await g.init(); await g.addConfig("user.email", "t@t").addConfig("user.name", "t");
  await g.checkoutLocalBranch("main");
  writeFileSync(join(repo, ".gitignore"), ".kunpeng/\nglobal-state/\n");
  writeFileSync(join(repo, "CHANGELOG.md"), CL);
  writeFileSync(join(repo, "a.txt"), "base");
  await g.add("."); await g.commit("base");
});
afterEach(() => {
  if (prevState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = prevState;
  if (prevInstance === undefined) delete process.env.KUNPENG_INSTANCE; else process.env.KUNPENG_INSTANCE = prevInstance;
  rmSync(repo, { recursive: true, force: true });
});

test("合并成功后 main 的 CHANGELOG [Unreleased] 多一条本流条目，两条流先后合并各记一条（作者锁定）", async () => {
  await makeFlow("f1", "b.txt", "# 修复看板幽灵流\n\n正文");
  await makeFlow("f2", "c.txt", "# 新增成本看板\n\n正文");
  const r1 = await mergeAndClearGate(repo, "f1", "main", GREEN);
  expect(r1.ok).toBe(true);
  expect(r1.note ?? "").toContain("CHANGELOG");
  const r2 = await mergeAndClearGate(repo, "f2", "main", GREEN);
  expect(r2.ok).toBe(true);
  const g = simpleGit(repo);
  const cl = await g.show(["main:CHANGELOG.md"]);
  const unrel = cl.slice(cl.indexOf("## [Unreleased]"), cl.indexOf("## [1.0.0]"));
  expect(unrel).toContain("### Fixed\n- 修复看板幽灵流（f1）\n");
  expect(unrel).toContain("### Added\n- 新增成本看板（f2）\n");
  expect(readFileSync(join(repo, "CHANGELOG.md"), "utf8")).toBe(cl);
  expect(await g.show(["main:b.txt"])).toBe("f1");
  expect(await g.show(["main:c.txt"])).toBe("f2");
  expect((await g.status()).isClean()).toBe(true);
});

test("仓库没有 CHANGELOG.md 时照常合并，不新建该文件", async () => {
  const g = simpleGit(repo);
  await g.rm("CHANGELOG.md"); await g.commit("drop changelog");
  await makeFlow("f3", "d.txt", "# 新增导出\n");
  const r = await mergeAndClearGate(repo, "f3", "main", GREEN);
  expect(r.ok).toBe(true);
  expect((await g.raw(["ls-tree", "--name-only", "main"])).split("\n")).not.toContain("CHANGELOG.md");
});