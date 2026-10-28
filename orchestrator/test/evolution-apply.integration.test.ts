/**
 * 集成 · 进化应用编排器（阶段三）。
 *
 * 用真实的阶段一/二纯模块（route / applyConventions / draftPlanFromUpgrades /
 * auditGeneratedPlan）+ 真实约定文件，端到端验证 applyApprovedProposals 的行为与安全不变式。
 * 仅 LLM 起草用 FakeRunner（确定性）、planRunner 用计数 spy。
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyApprovedProposals, type EvolutionProposal, type ApplyDeps } from "../src/evolution/apply.js";
import { route } from "../src/evolution/route.js";
import { applyConventions } from "../src/evolution/apply-conventions.js";
import { draftPlanFromUpgrades } from "../src/evolution/draft-plan.js";
import { auditGeneratedPlan } from "../src/evolution/audit-plan.js";
import { FakeRunner } from "../src/agent/runner.js";
import type { ProposedChange } from "../src/loop/self-evolution.js";

let dir: string;
let conventionsPath: string;
let corePath: string; // 仅用于断言"约定永不触碰 core"——故意可写却必须始终不被写。

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kp-apply-"));
  conventionsPath = join(dir, "conventions.md");
  corePath = join(dir, "core.md");
  await writeFile(conventionsPath, "# 可调约定\n", "utf8");
  await writeFile(corePath, "# 不可变核心\n", "utf8");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const conv = (text: string): ProposedChange => ({ target: "conventions", text, source: "exp-conv" });
const upgrade = (text: string): ProposedChange => ({ target: "upgrade", text, source: "exp-up" });
const evidence = { holdoutPassK: 0.9, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.8 } };

/** 计数 spy：记录被调用次数与最后一次收到的计划文本。 */
function spyPlanRunner() {
  const calls: string[] = [];
  const fn = async (planMd: string): Promise<void> => {
    calls.push(planMd);
  };
  return { fn, get calls() { return calls; } };
}

/** 组装注入依赖：真实纯模块 + 给定的起草计划文本 + 计数 planRunner。 */
function makeDeps(draftedPlan: string, planRunner: ApplyDeps["planRunner"]): ApplyDeps {
  return {
    conventionsPath,
    route,
    applyConventions,
    draftPlanFromUpgrades,
    auditGeneratedPlan,
    // 起草阶段的 LLM 用 FakeRunner，确定性返回给定计划文本。
    draftRunner: new FakeRunner({ spec: { text: draftedPlan, meta: {} } }),
    planRunner,
  };
}

test("约定提案 → 追加到 conventionsPath，conventionsApplied===1", async () => {
  const runner = spyPlanRunner();
  const deps = makeDeps("", runner.fn);
  const proposals: EvolutionProposal[] = [
    { id: "p-conv", status: "approved", changes: [conv("PR 必须带验证证据 (C3)")] },
  ];

  const report = await applyApprovedProposals(proposals, deps);

  expect(report.conventionsApplied).toBe(1);
  const after = await readFile(conventionsPath, "utf8");
  expect(after).toContain("- PR 必须带验证证据 (C3)");
  // 约定无需跑计划。
  expect(runner.calls).toHaveLength(0);
  expect(report.outcomes[0].status).toBe("verified");
});

test("安全升级 → 过审计、planRunner 恰运行一次、提案置 verified", async () => {
  const runner = spyPlanRunner();
  // 一份不含危险命令的计划。
  const safePlan = [
    "# 升级方案",
    "## 阶段一",
    "### flow A",
    "```accept",
    "cd orchestrator && npx --no-install vitest run",
    "```",
  ].join("\n");
  const deps = makeDeps(safePlan, runner.fn);
  const proposals: EvolutionProposal[] = [
    { id: "p-up", status: "approved", changes: [upgrade("把 vitest 升到最新小版本")], evidence },
  ];

  const report = await applyApprovedProposals(proposals, deps);

  // 审计放行 → 计划被执行恰一次，且执行的就是审计过的那份。
  expect(report.plansRun).toBe(1);
  expect(runner.calls).toHaveLength(1);
  expect(auditGeneratedPlan(runner.calls[0]).safe).toBe(true);
  expect(runner.calls[0]).not.toMatch(/rm\s+-rf/);
  expect(report.outcomes[0].status).toBe("verified");
  expect(report.outcomes[0].planRun).toBe(true);
});

test("危险升级 → 审计 fail-closed 拦下、planRunner 从不调用、提案维持 approved", async () => {
  const runner = spyPlanRunner();
  // LLM 起草出一份含 rm -rf 的计划——必须被审计门拦下。
  const dangerousPlan = [
    "# 升级方案",
    "## 阶段一",
    "### flow B",
    "```accept",
    "rm -rf ./node_modules && reinstall",
    "```",
  ].join("\n");
  const deps = makeDeps(dangerousPlan, runner.fn);
  const proposals: EvolutionProposal[] = [
    { id: "p-danger", status: "approved", changes: [upgrade("重装依赖")], evidence },
  ];

  const report = await applyApprovedProposals(proposals, deps);

  // fail-closed：计划从不运行，提案维持 approved。
  expect(runner.calls).toHaveLength(0);
  expect(report.plansRun).toBe(0);
  expect(report.outcomes[0].status).toBe("approved");
  expect(report.outcomes[0].planRun).toBe(false);
  expect(report.outcomes[0].violations.some((v) => v.id === "rm-rf")).toBe(true);
});

test("安全不变式：只处理 approved——draft/已 verified 的提案原样跳过", async () => {
  const runner = spyPlanRunner();
  const deps = makeDeps("", runner.fn);
  const proposals: EvolutionProposal[] = [
    { id: "p-draft", status: "draft", changes: [conv("不该被应用的约定")] },
    { id: "p-done", status: "verified", changes: [upgrade("不该被跑的升级")] },
  ];

  const report = await applyApprovedProposals(proposals, deps);

  expect(report.conventionsApplied).toBe(0);
  expect(report.plansRun).toBe(0);
  expect(runner.calls).toHaveLength(0);
  // 状态原样保留。
  expect(report.outcomes.map((o) => o.status)).toEqual(["draft", "verified"]);
  // 约定文件未被改写。
  expect(await readFile(conventionsPath, "utf8")).toBe("# 可调约定\n");
});

test("安全不变式：约定永不触碰 core——core 目标被兜到 unrouted，core 文件与约定文件均不被写", async () => {
  const runner = spyPlanRunner();
  const deps = makeDeps("", runner.fn);
  const coreChange: ProposedChange = { target: "constitution/core.md", text: "偷改核心", source: "evil" };
  const proposals: EvolutionProposal[] = [
    { id: "p-core", status: "approved", changes: [coreChange] },
  ];

  const report = await applyApprovedProposals(proposals, deps);

  expect(report.conventionsApplied).toBe(0);
  expect(report.outcomes[0].unrouted).toHaveLength(1);
  expect(report.outcomes[0].unrouted[0].target).toBe("constitution/core.md");
  // 既无落地动作 → 维持 approved（不伪造 verified）。
  expect(report.outcomes[0].status).toBe("approved");
  // core 文件与约定文件都纹丝不动。
  expect(await readFile(corePath, "utf8")).toBe("# 不可变核心\n");
  expect(await readFile(conventionsPath, "utf8")).toBe("# 可调约定\n");
});

test("安全不变式：编排器绝不自合并——成功提案至多到 verified，落主干仍是人工门 (C5#1)", async () => {
  const runner = spyPlanRunner();
  const safePlan = [
    "# 升级方案",
    "```accept",
    "cd orchestrator && npx --no-install vitest run",
    "```",
  ].join("\n");
  const deps = makeDeps(safePlan, runner.fn);
  const proposals: EvolutionProposal[] = [
    { id: "p-up", status: "approved", changes: [upgrade("安全升级")], evidence },
  ];

  const report = await applyApprovedProposals(proposals, deps);

  // 最高只能到 verified，绝无 "merged"/"landed" 这类自合并终态。
  for (const o of report.outcomes) {
    expect(["approved", "verified"]).toContain(o.status);
    expect(o.status).not.toBe("merged");
  }
  // 模块从未暴露任何 merge 能力（结构性护栏）。
  const mod = await import("../src/evolution/apply.js");
  expect((mod as Record<string, unknown>).merge).toBeUndefined();
  expect((mod as Record<string, unknown>).mergeToMain).toBeUndefined();
});

test("整批混合：约定+安全升级+危险升级+非批准 一次处理，计数与各自结局正确", async () => {
  const runner = spyPlanRunner();
  // 注意：本批两个 upgrade 提案共用同一 draftRunner，故起草文本一致；
  // 用一份"安全"计划，让 fail-closed 的区分落在 changes 内容无关、由审计门统一判定。
  // 为分别覆盖 safe / unsafe，这里改用各自独立的 deps。
  const safePlan = ["# 安全", "```accept", "npx --no-install vitest run", "```"].join("\n");

  const report = await applyApprovedProposals(
    [
      { id: "a-conv", status: "approved", changes: [conv("新约定 X")] },
      { id: "a-up", status: "approved", changes: [upgrade("安全升级")], evidence },
      { id: "a-skip", status: "draft", changes: [conv("跳过")] },
    ],
    makeDeps(safePlan, runner.fn),
  );

  expect(report.conventionsApplied).toBe(1); // 仅 a-conv
  expect(report.plansRun).toBe(1); // 仅 a-up
  expect(runner.calls).toHaveLength(1);
  expect(report.outcomes.map((o) => `${o.id}:${o.status}`)).toEqual([
    "a-conv:verified",
    "a-up:verified",
    "a-skip:draft",
  ]);
});
