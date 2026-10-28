import { describe, expect, test } from "vitest";
import { parseMethodPlan } from "../plan/parse.js";

// 锁死「合格 build-spec」的契约：真 plan 解析器能拆出带 acceptanceCmd 的 flow。
// 这是 specToBuildSpec 的 agent 必须命中的目标格式（真 agent 端到端见 README/手动冒烟）。
describe("build-spec 必须被真 plan 解析器接受", () => {
  test("单H1 + accept 块 → 拆出带 acceptanceCmd 的 flow", () => {
    const buildSpec = [
      "# 段一：研发指挥仪表盘",
      "",
      "实现 GET /api/dashboard 返回各项目 id/phase/cost。",
      "",
      "```scope",
      "allow: orchestrator/src/server/http.ts",
      "```",
      "",
      "```accept",
      "npx vitest run test/server/dashboard.test.ts",
      "```",
    ].join("\n");
    const model = parseMethodPlan(buildSpec);
    const flows = model.phases.flatMap((p) => p.flows);
    expect(flows.length).toBeGreaterThanOrEqual(1);
    expect(flows.some((f) => (f.acceptanceCmd ?? "").includes("vitest"))).toBe(true);
  });
});
