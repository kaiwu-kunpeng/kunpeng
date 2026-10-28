import { expect, test } from "vitest";
import type { AgentRunner } from "../src/agent/runner.js";
import type { ProductDefinition } from "../src/product/contract.js";
import { buildDiscoverPrompt, discoverProduct } from "../src/product/stages.js";

function fakeRunner(output: unknown): AgentRunner {
  return { run: async () => output } as AgentRunner;
}

function capturingRunner(output: unknown): { runner: AgentRunner; stages: string[]; inputs: string[] } {
  const stages: string[] = [];
  const inputs: string[] = [];
  return {
    stages,
    inputs,
    runner: {
      run: async (request) => {
        stages.push(request.stage);
        inputs.push(request.input);
        expect(request.system).toBe("");
        expect(request.tools).toEqual([]);
        return output;
      },
    } as AgentRunner,
  };
}

const definition: ProductDefinition = {
  idea: "待办协作",
  problem: "团队任务分散",
  users: ["项目经理"],
  stories: ["作为项目经理，我要看到任务状态"],
  acceptance: ["能创建任务"],
};

test("product-discover parses job, target users, alternatives, and deterministically scores opportunities", async () => {
  const fake = capturingRunner(
    JSON.stringify({
      jobStatement: "当项目推进时，项目经理要掌握任务进展",
      targetUsers: ["项目经理"],
      alternatives: ["表格", "群消息"],
      opportunities: [{ outcome: "减少漏跟进", importance: 9, satisfaction: 3, opportunityScore: 999 }],
      syntheticEvidence: true,
    }),
  );

  const discovery = await discoverProduct(definition, fake.runner);

  expect(fake.stages).toEqual(["spec"]);
  expect(fake.inputs[0]).toContain("DISCOVER");
  expect(fake.inputs[0]).toContain("syntheticEvidence 必须为 true");
  expect(fake.inputs[0]).toContain("opportunityScore 由系统确定性计算");
  expect(fake.inputs[0]).not.toContain('"opportunityScore":number');
  expect(discovery.definition).toBe(definition);
  expect(discovery.jobStatement).toContain("项目经理");
  expect(discovery.targetUsers).toEqual(["项目经理"]);
  expect(discovery.alternatives).toEqual(["表格", "群消息"]);
  expect(discovery.opportunities).toEqual([
    { outcome: "减少漏跟进", importance: 9, satisfaction: 3, opportunityScore: 15 },
  ]);
  expect(discovery.syntheticEvidence).toBe(true);
});

test("product-discover rejects output without JSON object", async () => {
  await expect(discoverProduct(definition, fakeRunner("not json"))).rejects.toThrow(
    "discoverProduct: 无法从 agent 输出解析 DISCOVER 产物",
  );
});

test("product-discover prompt is deterministic", () => {
  expect(buildDiscoverPrompt(definition)).toBe(buildDiscoverPrompt(definition));
});
