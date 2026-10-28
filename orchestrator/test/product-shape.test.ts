import { expect, test } from "vitest";
import type { AgentRunner } from "../src/agent/runner.js";
import type { ProductDefinition, ProductDiscovery } from "../src/product/contract.js";
import { buildShapePrompt, shapeProduct } from "../src/product/stages.js";

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

const discovery: ProductDiscovery = {
  definition,
  jobStatement: "当项目推进时，项目经理要掌握任务进展",
  targetUsers: ["项目经理"],
  alternatives: ["表格"],
  opportunities: [{ outcome: "减少漏跟进", importance: 9, satisfaction: 3, opportunityScore: 15 }],
  syntheticEvidence: true,
};

test("product-shape parses shaped pitch with appetite, rabbit holes, and no-gos", async () => {
  const fake = capturingRunner(
    JSON.stringify({
      title: "任务进展单页",
      appetite: "2 days",
      problem: "项目经理无法快速看到任务状态",
      solution: "提供任务列表、状态和负责人",
      buildScope: ["创建任务", "标记完成"],
      rabbitHoles: ["复杂权限"],
      noGos: ["即时通讯替代"],
      successMetrics: ["3 分钟内创建首个任务"],
    }),
  );

  const pitch = await shapeProduct(discovery, fake.runner);

  expect(fake.stages).toEqual(["design"]);
  expect(fake.inputs[0]).toContain("SHAPE");
  expect(pitch).toEqual({
    title: "任务进展单页",
    appetite: "2 days",
    problem: "项目经理无法快速看到任务状态",
    solution: "提供任务列表、状态和负责人",
    buildScope: ["创建任务", "标记完成"],
    rabbitHoles: ["复杂权限"],
    noGos: ["即时通讯替代"],
    successMetrics: ["3 分钟内创建首个任务"],
  });
});

test("product-shape prompt is deterministic", () => {
  expect(buildShapePrompt(discovery)).toBe(buildShapePrompt(discovery));
});
