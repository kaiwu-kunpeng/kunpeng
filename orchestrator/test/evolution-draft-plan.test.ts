import { describe, expect, test } from "vitest";
import { draftPlanFromUpgrades } from "../src/evolution/draft-plan.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../src/agent/runner.js";
import type { ProposedChange } from "../src/loop/self-evolution.js";

describe("draftPlanFromUpgrades — 升级翻方案（纯函数、透传后端产出）", () => {
  test("原样返回后端 result.text，且把升级文本内嵌进 req.input", async () => {
    const captured: AgentRequest[] = [];
    const runner: AgentRunner = {
      async run(req: AgentRequest): Promise<AgentResult> {
        captured.push(req);
        return { text: "# drafted plan", meta: {} };
      },
    };

    const upgrades: ProposedChange[] = [
      { target: "upgrade", text: "加缓存层", source: "research:https://x" },
    ];

    const out = await draftPlanFromUpgrades(upgrades, runner);

    expect(out).toBe("# drafted plan");
    expect(captured).toHaveLength(1);
    expect(captured[0].stage).toBe("spec");
    expect(captured[0].input).toContain("加缓存层");
  });
});
