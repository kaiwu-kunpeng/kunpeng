// orchestrator/test/product/plan-calibration.test.ts —— 作者亲写,严禁改（框架写盘锁定）
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { buildProductPlan } from "../../src/product/plan.js";

const H = 3_600_000;

async function seedRepo(repo: string, verifiedFlowHours: number[]): Promise<void> {
  // 真 interview.json：定义带 Gherkin 验收 → storyMap 有任务 → forecast 非空。
  await mkdir(join(repo, ".kunpeng", "product"), { recursive: true });
  const definition = {
    idea: "x", problem: "p", users: ["u"], stories: ["s"],
    acceptance: ["Scenario: 登录\nGiven 访客\nWhen 提交凭证\nThen 进入主页"],
    nonGoals: ["n"],
  };
  await writeFile(
    join(repo, ".kunpeng", "product", "interview.json"),
    JSON.stringify({ idea: "x", status: "done", step: 0, answers: [], definition }),
    "utf8",
  );
  // 真 verified 流 json 落 canonical 状态目录 .kunpeng/state。
  await mkdir(join(repo, ".kunpeng", "state"), { recursive: true });
  let i = 0;
  for (const hours of verifiedFlowHours) {
    const fs = {
      flowId: `f${i}`, requirement: "r", stage: "done", status: "verified",
      agentActive: false, startedAt: 0, updatedAt: Math.round(hours * H), history: [],
    };
    await writeFile(join(repo, ".kunpeng", "state", `f${i}.json`), JSON.stringify(fs), "utf8");
    i += 1;
  }
}

describe("buildProductPlan 估算自动校准", () => {
  it("≥3 个 verified 历史流 → forecast.calibrated=true", async () => {
    const repo = await mkdtemp(join(tmpdir(), "kp-cal-"));
    await seedRepo(repo, [8, 12, 6]);
    const plan = await buildProductPlan(repo);
    expect(plan.forecast).not.toBeNull();
    expect(plan.forecast?.calibrated).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });
  it("历史流不足 → forecast 仍出但 calibrated=false(回退默认谱)", async () => {
    const repo = await mkdtemp(join(tmpdir(), "kp-cal-"));
    await seedRepo(repo, [8]); // 只 1 个 verified,不足 minSamples
    const plan = await buildProductPlan(repo);
    expect(plan.forecast).not.toBeNull();
    expect(plan.forecast?.calibrated).toBe(false);
    await rm(repo, { recursive: true, force: true });
  });
});