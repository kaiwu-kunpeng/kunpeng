import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { aggregateRedFirstEvidence } from "../../src/runtime/merge-tier-evidence.js";
import { buildAutopilotGuards } from "../../src/server/autopilot-guards.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

const execFileAsync = promisify(execFile);

function baseline(passed: boolean) {
  return { acceptEvidence: { baseline: { passed, exitCode: passed ? 0 : 1, at: 1, attempt: 1, logPath: "/tmp/x" } } };
}

describe("先红证据聚合：plan 壳流没有自己的验收证据时看子流（作者锁定）", () => {
  it("自己有 baseline：红 → redFirst，绿 → baselineGreen，不看子流", () => {
    expect(aggregateRedFirstEvidence(baseline(false), [baseline(true)])).toEqual({ redFirst: true });
    expect(aggregateRedFirstEvidence(baseline(true), [baseline(false)])).toEqual({ baselineGreen: true });
  });
  it("自己没有：子流全红 → redFirst；任一子流绿 → baselineGreen", () => {
    expect(aggregateRedFirstEvidence({}, [baseline(false), baseline(false)])).toEqual({ redFirst: true });
    expect(aggregateRedFirstEvidence(null, [baseline(false), baseline(true)])).toEqual({ baselineGreen: true });
  });
  it("没有子流、或任一子流缺 baseline → 两项都 undefined（维持「缺少先红证据」）", () => {
    expect(aggregateRedFirstEvidence({}, [])).toEqual({});
    expect(aggregateRedFirstEvidence(null, [baseline(false), {}])).toEqual({});
    expect(aggregateRedFirstEvidence({ acceptEvidence: { final: { passed: true, exitCode: 0, at: 1, attempt: 1, logPath: "" } } }, [{ acceptEvidence: {} }])).toEqual({});
  });
});

/** 真 git 仓 + 真 FlowTracker：main 一份文件，kp/plan-p1 改了它。 */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-tier-plan-"));
  const git = (...args: string[]) => execFileAsync("git", args, { cwd: dir });
  await git("init", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "t");
  await mkdir(join(dir, "lib"), { recursive: true });
  await writeFile(join(dir, "lib", "calc.ts"), "export const a = 1;\n");
  await git("add", "lib/calc.ts");
  await git("commit", "-m", "base");
  await git("checkout", "-b", "kp/plan-p1");
  await writeFile(join(dir, "lib", "calc.ts"), "export const a = 2;\n");
  await git("add", "lib/calc.ts");
  await git("commit", "-m", "change");
  await git("checkout", "main");
  return dir;
}

describe("autopilot 分级表对 plan 壳流读子流的先红证据（真仓真 tracker，作者锁定）", () => {
  it("两个子流 baseline 都红 → plan 壳流不再命中 no-red-first-evidence，tier=auto", async () => {
    const dir = await makeRepo();
    const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));
    await tracker.start("plan-p1", "壳流");
    await tracker.start("child-a", "子流 A", { planId: "plan-p1", phase: 0 });
    await tracker.start("child-b", "子流 B", { planId: "plan-p1", phase: 1 });
    await tracker.setAcceptEvidence("child-a", { baseline: { passed: false, exitCode: 1, at: 1, attempt: 1, logPath: "/tmp/a" } });
    await tracker.setAcceptEvidence("child-b", { baseline: { passed: false, exitCode: 1, at: 1, attempt: 1, logPath: "/tmp/b" } });
    const guards = buildAutopilotGuards(dir, tracker);
    const verdict = await guards.tier("plan-p1", "main");
    expect(verdict.ruleIds).not.toContain("no-red-first-evidence");
    expect(verdict.ruleIds).not.toContain("baseline-green");
    expect(verdict.tier).toBe("auto");
  });

  it("任一子流 baseline 绿 → plan 壳流命中 baseline-green，tier=human", async () => {
    const dir = await makeRepo();
    const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));
    await tracker.start("plan-p1", "壳流");
    await tracker.start("child-a", "子流 A", { planId: "plan-p1", phase: 0 });
    await tracker.start("child-b", "子流 B", { planId: "plan-p1", phase: 0 });
    await tracker.setAcceptEvidence("child-a", { baseline: { passed: false, exitCode: 1, at: 1, attempt: 1, logPath: "/tmp/a" } });
    await tracker.setAcceptEvidence("child-b", { baseline: { passed: true, exitCode: 0, at: 1, attempt: 1, logPath: "/tmp/b" } });
    const guards = buildAutopilotGuards(dir, tracker);
    const verdict = await guards.tier("plan-p1", "main");
    expect(verdict.ruleIds).toContain("baseline-green");
    expect(verdict.tier).toBe("human");
  });

  it("没有子流也没有自己的证据 → 仍报 no-red-first-evidence（不凭空放行）", async () => {
    const dir = await makeRepo();
    const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));
    await tracker.start("plan-p1", "壳流");
    await tracker.start("other-child", "别家的子流", { planId: "plan-p9", phase: 0 });
    await tracker.setAcceptEvidence("other-child", { baseline: { passed: false, exitCode: 1, at: 1, attempt: 1, logPath: "/tmp/o" } });
    const guards = buildAutopilotGuards(dir, tracker);
    const verdict = await guards.tier("plan-p1", "main");
    expect(verdict.ruleIds).toContain("no-red-first-evidence");
    expect(verdict.tier).toBe("human");
  });
});