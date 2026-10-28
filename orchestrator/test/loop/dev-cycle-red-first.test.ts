import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { FakeRunner } from "../../src/agent/runner.js";
import { Workspace } from "../../src/git/workspace.js";
import { DevCycle } from "../../src/loop/dev-cycle.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

// 本文件整体嵌在 spec 围栏里,正文不能出现三个反引号。
const FENCE = "`".repeat(3);
const SCOPED_REQ = ["# 在 src/in 下改文件", "", `${FENCE}scope`, "allow: src/in/**", FENCE].join("\n");
// 基线上恒绿(README 里本来就有 base):没先红。
const GREEN_ON_BASELINE = "mkdir -p src/in && echo a > src/in/a.ts && grep -q base README.md";
// 第一次跑(基线)文件不存在 → 造出来并退出 1(红);第二次跑(实现后)文件在且内容对 → 0(绿)。
const RED_THEN_GREEN = "{ [ -f src/in/a.ts ] && grep -q a src/in/a.ts; } || { mkdir -p src/in; echo a > src/in/a.ts; exit 1; }";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-red-first-"));
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  await git.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  await git.add(".");
  await git.commit("init");
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

function makeCycle(flowId: string, acceptanceCmd: string, redFirst?: boolean): DevCycle {
  return new DevCycle({
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new FakeRunner({ spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" }, implement: { text: "done", meta: {}, backend: "claude" } }),
    flowId,
    acceptanceCmd,
    ...(redFirst === undefined ? {} : { redFirst }),
  });
}

const tracker = () => new FlowTracker(join(repo, ".kunpeng", "state"));
const acceptLog = (flowId: string, n: number) => join(repo, ".kunpeng", "accept-logs", flowId, `${n}.txt`);

describe("先红核查与合并门证据（作者锁定）", () => {
  test("redFirst 开 + 基线已绿 → 回滚 not-red-first，不进 implement，基线证据落盘", async () => {
    const r = await makeCycle("rf-green", GREEN_ON_BASELINE, true).run(SCOPED_REQ);
    expect(r.status).toBe("rolled-back");
    const s = (await tracker().read("rf-green"))!;
    expect(s.status).toBe("rolled-back");
    expect(s.rollback?.kind).toBe("not-red-first");
    expect(s.rollback?.summary).toContain("没先红");
    expect(s.failureReason).toContain("没先红");
    expect(s.history.map((h) => h.stage)).not.toContain("implement");
    expect(s.acceptEvidence?.baseline?.passed).toBe(true);
    expect(s.acceptEvidence?.baseline?.attempt).toBe(1);
    expect(s.acceptEvidence?.final).toBeUndefined();
    expect(existsSync(acceptLog("rf-green", 1))).toBe(true);
    expect(readFileSync(acceptLog("rf-green", 1), "utf8")).toContain("# phase: baseline");
    expect(existsSync(acceptLog("rf-green", 2))).toBe(false);
  });

  test("redFirst 开 + 基线红、实现后绿 → verified，基线红/终态绿/diff 统计三样齐", async () => {
    const r = await makeCycle("rf-ok", RED_THEN_GREEN, true).run(SCOPED_REQ);
    expect(r.status).toBe("verified");
    const s = (await tracker().read("rf-ok"))!;
    expect(s.status).toBe("verified");
    expect(s.acceptEvidence?.baseline?.passed).toBe(false);
    expect(s.acceptEvidence?.baseline?.exitCode).toBe(1);
    expect(s.acceptEvidence?.baseline?.attempt).toBe(1);
    expect(s.acceptEvidence?.final?.passed).toBe(true);
    expect(s.acceptEvidence?.final?.attempt).toBe(2);
    expect(s.acceptEvidence?.final?.logPath).toBe(acceptLog("rf-ok", 2));
    expect(s.acceptEvidence?.diffStat?.files).toBeGreaterThanOrEqual(1);
    expect(s.acceptEvidence?.diffStat?.insertions).toBeGreaterThanOrEqual(1);
    expect(s.changedFileCount).toBeGreaterThanOrEqual(1);
    expect(readFileSync(acceptLog("rf-ok", 1), "utf8")).toContain("# phase: baseline");
    expect(readFileSync(acceptLog("rf-ok", 2), "utf8")).toContain("# phase: final");
  });

  test("redFirst 缺省关 → 基线已绿的验收照旧 verified（既有调用方行为不变），但终态证据仍落盘", async () => {
    const r = await makeCycle("rf-off", GREEN_ON_BASELINE).run(SCOPED_REQ);
    expect(r.status).toBe("verified");
    const s = (await tracker().read("rf-off"))!;
    expect(s.acceptEvidence?.baseline).toBeUndefined();
    expect(s.acceptEvidence?.final?.passed).toBe(true);
    expect(s.acceptEvidence?.final?.attempt).toBe(1);
    expect(s.acceptEvidence?.diffStat?.files).toBeGreaterThanOrEqual(1);
    expect(existsSync(acceptLog("rf-off", 2))).toBe(false);
  });

  test("CLI 入口翻默认：两处 requireScope 旁都传 resolveRedFirst；plan 编排器透传", () => {
    const devcycle = readFileSync(new URL("../../src/cli-commands/devcycle.ts", import.meta.url), "utf8");
    const loopCore = readFileSync(new URL("../../src/cli-commands/loop-core.ts", import.meta.url), "utf8");
    const orchestrator = readFileSync(new URL("../../src/plan/orchestrator.ts", import.meta.url), "utf8");
    expect(devcycle).toContain("redFirst: resolveRedFirst(process.env)");
    expect(loopCore).toContain("redFirst: resolveRedFirst(process.env)");
    expect(orchestrator).toContain("redFirst?: boolean");
    expect(orchestrator).toContain("redFirst: d.redFirst");
  });
});