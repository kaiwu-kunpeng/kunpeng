import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { FakeRunner } from "../src/agent/runner.js";
import type { ProductDefinition, ProductDiscovery, ShapedPitch } from "../src/product/contract.js";
import { runProductDiscover, runProductShape, runProductValidate } from "../src/product/pipeline.js";
import {
  readProductDiscovery,
  readProductValidation,
  readShapedPitch,
  writeInterview,
  writeProductDiscovery,
  writeShapedPitch,
} from "../src/product/store.js";

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-product-pipeline-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

const pitch: ShapedPitch = {
  title: "任务进展单页",
  appetite: "2 days",
  problem: "项目经理无法快速看到任务状态",
  solution: "提供任务列表、状态和负责人",
  buildScope: ["创建任务", "标记完成"],
  rabbitHoles: ["复杂权限"],
  noGos: ["即时通讯替代"],
  successMetrics: ["3 分钟内创建首个任务"],
};

test("discover 缺定义时报清晰错", async () => {
  const repo = await makeRepo();
  const runner = new FakeRunner({});

  await expect(runProductDiscover(repo, runner)).rejects.toThrow("先运行 kunpeng product");
});

test("discover 串通：有定义→产出并落 store", async () => {
  const repo = await makeRepo();
  await writeInterview(repo, { idea: definition.idea, status: "done", step: 5, answers: [], definition });
  const runner = new FakeRunner({
    spec: {
      text: JSON.stringify({
        jobStatement: discovery.jobStatement,
        targetUsers: discovery.targetUsers,
        alternatives: discovery.alternatives,
        opportunities: [{ outcome: "减少漏跟进", importance: 9, satisfaction: 3 }],
        syntheticEvidence: true,
      }),
      meta: {},
    },
  });

  const result = await runProductDiscover(repo, runner);

  expect(result).toEqual(discovery);
  await expect(readProductDiscovery(repo)).resolves.toEqual(result);
});

test("shape 缺 discover 时报错", async () => {
  const repo = await makeRepo();
  const runner = new FakeRunner({});

  await expect(runProductShape(repo, runner)).rejects.toThrow("product discover");
});

test("shape 串通", async () => {
  const repo = await makeRepo();
  await writeProductDiscovery(repo, discovery);
  const runner = new FakeRunner({
    design: {
      text: JSON.stringify(pitch),
      meta: {},
    },
  });

  const result = await runProductShape(repo, runner);

  expect(result).toEqual(pitch);
  await expect(readShapedPitch(repo)).resolves.toEqual(result);
});

test("validate 缺 shape 时报错", async () => {
  const repo = await makeRepo();

  await expect(runProductValidate(repo, { hypotheses: [], signals: [] })).rejects.toThrow("product shape");
});

test("validate 合成信号→inconclusive + 需人工门", async () => {
  const repo = await makeRepo();
  await writeShapedPitch(repo, pitch);

  const validation = await runProductValidate(repo, {
    hypotheses: ["h"],
    signals: [{ source: "假设用户", kind: "interview", summary: "s", synthetic: true }],
  });

  expect(validation.decision).toBe("inconclusive");
  expect(validation.requiresHumanGate).toBe(true);
  await expect(readProductValidation(repo)).resolves.toEqual(validation);
});
