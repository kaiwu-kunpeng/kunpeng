import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const REQ = ["# 在 src/in 下改文件", "", `${FENCE}scope`, "allow: src/in/**", FENCE].join("\n");
const ACCEPT = "mkdir -p src/in && echo a > src/in/a.ts && grep -q base README.md";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-dc-budget-"));
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

type Verdict = { level: "ok" | "warn50" | "warn80" | "halt"; reason: string };
function makeCycle(flowId: string, opts: { budget?: (stage: string) => Verdict; slotLog?: string[] }): DevCycle {
  return new DevCycle({
    store: new ArtifactStore(join(repo, ".kunpeng", "artifacts")),
    ws: new Workspace(repo),
    tracker: new FlowTracker(join(repo, ".kunpeng", "state")),
    runner: new FakeRunner({ spec: { text: "## acceptance\n- ok", meta: {}, backend: "claude" }, implement: { text: "done", meta: {}, backend: "claude" } }),
    flowId,
    acceptanceCmd: ACCEPT,
    ...(opts.budget ? { budgetCheck: async ({ stage }) => opts.budget!(stage) } : {}),
    ...(opts.slotLog ? { acquireSlot: async () => { opts.slotLog!.push("acquire"); return async () => { opts.slotLog!.push("release"); }; } } : {}),
  });
}
const tracker = () => new FlowTracker(join(repo, ".kunpeng", "state"));

describe("DevCycle 预算钩子与槽位（作者锁定）", () => {
  test("implement 后 halt → stopped、blocker 带原因、history 有 stopped、不进 verify", async () => {
    const seen: string[] = [];
    const r = await makeCycle("b-halt", { budget: (stage) => { seen.push(stage); return { level: "halt", reason: "budget-exceeded: usd 120%" }; } }).run(REQ);
    expect(r.status).toBe("stopped");
    expect(r.evidence).toContain("超预算暂停");
    expect(seen).toEqual(["implement"]);
    const s = (await tracker().read("b-halt"))!;
    expect(s.status).toBe("stopped");
    expect(s.blocker).toBe("budget-exceeded: usd 120%");
    expect(s.history.map((h) => h.stage)).toContain("stopped");
    expect(s.history.map((h) => h.stage)).not.toContain("verify");
  });

  test("warn80 只告警不停：照常 verified", async () => {
    const r = await makeCycle("b-warn", { budget: () => ({ level: "warn80", reason: "budget-warning: usd 85%" }) }).run(REQ);
    expect(r.status).toBe("verified");
    expect((await tracker().read("b-warn"))!.status).toBe("verified");
  });

  test("不注入钩子 → 行为不变（verified）", async () => {
    expect((await makeCycle("b-none", {}).run(REQ)).status).toBe("verified");
  });

  test("槽位：开头 acquire、结束 release，halt 路径也释放", async () => {
    const log: string[] = [];
    await makeCycle("b-slot-ok", { slotLog: log }).run(REQ);
    expect(log).toEqual(["acquire", "release"]);
    const log2: string[] = [];
    await makeCycle("b-slot-halt", { slotLog: log2, budget: () => ({ level: "halt", reason: "budget-exceeded: tokens 100%" }) }).run(REQ);
    expect(log2).toEqual(["acquire", "release"]);
  });

  test("CLI 接线：run/resume/plan 都装了预算钩子与槽位；resume 清超预算卡点", () => {
    const devcycle = readFileSync(new URL("../../src/cli-commands/devcycle.ts", import.meta.url), "utf8");
    const loopCore = readFileSync(new URL("../../src/cli-commands/loop-core.ts", import.meta.url), "utf8");
    const orchestrator = readFileSync(new URL("../../src/plan/orchestrator.ts", import.meta.url), "utf8");
    expect((devcycle.match(/makeBudgetCheck\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((devcycle.match(/acquireFlowSlot\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(devcycle).toContain("baselineFlowId: flowId");
    expect(devcycle).toContain("isBudgetBlocker(");
    expect(devcycle).toContain("clearBlocker(");
    expect(loopCore).toContain("makeBudgetCheck(");
    expect(loopCore).toContain("acquireFlowSlot(");
    expect(orchestrator).toContain("budgetCheck: d.budgetCheck");
    expect(orchestrator).toContain("acquireSlot: d.acquireSlot");
  });
});