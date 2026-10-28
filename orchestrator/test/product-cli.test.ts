import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { AgentRequest, AgentResult, AgentRunner, Stage } from "../src/agent/runner.js";
import "../src/cli-commands/product.js";
import { listCliCommands } from "../src/cli-commands/registry.js";
import { runProductCommand } from "../src/product/cli.js";
import { readInterview } from "../src/product/store.js";
import { cliSource } from "./helpers/cli-source.js";

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-product-cli-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const concreteDefinition = {
  problem: "当 20 人项目团队同时推进多个客户交付时，项目经理无法在每日站会前看清阻塞任务。",
  jobStatement: "当客户交付临近时，项目经理想快速识别阻塞任务，以便及时协调负责人。",
  users: ["20 人项目团队的项目经理"],
  stories: ["作为项目经理，我要看到任务状态"],
  acceptance: ["能创建任务"],
  nonGoals: ["不做跨公司项目组合管理"],
};

function resultText(value: unknown): AgentResult {
  return { text: JSON.stringify(value), meta: {} };
}

function fakeRunner(scripted: Partial<Record<Stage, AgentResult | ((req: AgentRequest) => AgentResult | Promise<AgentResult>)>> = {}): AgentRunner {
  return {
    run: async (req) => {
      const script = scripted[req.stage];
      if (typeof script === "function") return script(req);
      if (script) return script;
      if (req.stage === "spec") return resultText(concreteDefinition);
      if (req.stage === "review") return resultText({ findings: [], verdict: "pass" });
      throw new Error(`no scripted result for stage: ${req.stage}`);
    },
  };
}

test("runProductCommand turns one sentence into a done product session and draft spec", async () => {
  const repo = await makeRepo();

  const result = await runProductCommand({ repoRoot: repo, idea: " 做个待办协作 ", runner: fakeRunner() });

  expect(result.draftSpecPath).toBe(join(repo, ".kunpeng", "product", "draft-spec.md"));
  await expect(readInterview(repo)).resolves.toMatchObject({
    idea: "做个待办协作",
    status: "done",
    step: 5,
    definition: {
      idea: "做个待办协作",
      problem: concreteDefinition.problem,
      users: concreteDefinition.users,
      stories: ["作为项目经理，我要看到任务状态"],
      acceptance: ["能创建任务"],
    },
  });

  const spec = await readFile(result.draftSpecPath, "utf8");
  expect(spec).toContain("# 段一：做个待办协作");
  expect(spec).toContain(`**[prfaq-problem] 问题**：${concreteDefinition.problem}`);
  expect(spec).toContain("Scenario: 能创建任务");
});

test("runProductCommand rejects an empty idea before calling the runner", async () => {
  let called = false;
  const repo = await makeRepo();

  await expect(
    runProductCommand({
      repoRoot: repo,
      idea: " ",
      runner: {
        run: async () => {
          called = true;
          return { text: "{}", meta: {} };
        },
      },
    }),
  ).rejects.toThrow("产品想法不能为空");
  expect(called).toBe(false);
});

test("cli dispatch text registers product command", () => {
  const cliText = cliSource();

  expect(listCliCommands().map((command) => command.name)).toContain("product");
  expect(cliText).toContain("命令: run | plan | product | merge");
});

test("runProductCommand writes draft spec gate and returns matching gate result", async () => {
  const repo = await makeRepo();
  const result = await runProductCommand({
    repoRoot: repo,
    idea: "做个待办协作",
    runner: fakeRunner({
      spec: resultText(concreteDefinition),
      review: resultText({
        findings: [{ severity: "warn", category: "metric", issue: "指标仍偏宽", suggestion: "补具体领先指标" }],
        verdict: "revise",
      }),
    }),
  });

  expect(result.gatePath).toBe(join(repo, ".kunpeng", "product", "draft-spec.gate.json"));
  const gate = JSON.parse(await readFile(result.gatePath, "utf8")) as typeof result.gate;
  expect(gate).toHaveProperty("blocked");
  expect(gate).toHaveProperty("concreteness");
  expect(gate).toHaveProperty("critique");
  expect(result.gate.blocked).toBe(gate.blocked);
  expect(result.gate.concreteness.pass).toBe(gate.concreteness.pass);
  expect(result.gate.critique.verdict).toBe(gate.critique.verdict);
  expect(result.gate.critique.llmRan).toBe(true);
});

test("runProductCommand blocks an unconcrete definition", async () => {
  const repo = await makeRepo();

  const result = await runProductCommand({
    repoRoot: repo,
    idea: "提升效率",
    runner: fakeRunner({
      spec: resultText({
        problem: "提升效率",
        users: [],
        stories: ["作为用户，我要提升效率"],
        acceptance: ["能看到页面"],
      }),
      review: resultText({ findings: [], verdict: "pass" }),
    }),
  });

  expect(result.gate.blocked).toBe(true);
});

test("runProductCommand fail-softs when review stage fails or returns invalid text", async () => {
  const repoWithThrowingReview = await makeRepo();
  const throwingResult = await runProductCommand({
    repoRoot: repoWithThrowingReview,
    idea: "做个待办协作",
    runner: fakeRunner({
      review: async () => {
        throw new Error("review unavailable");
      },
    }),
  });

  expect(throwingResult.gate.critique.llmRan).toBe(false);
  await expect(readFile(throwingResult.gatePath, "utf8")).resolves.toContain('"llmRan": false');

  const repoWithGarbageReview = await makeRepo();
  const garbageResult = await runProductCommand({
    repoRoot: repoWithGarbageReview,
    idea: "做个待办协作",
    runner: fakeRunner({
      review: { text: "not-json", meta: {} },
    }),
  });

  expect(garbageResult.gate.critique.llmRan).toBe(false);
  await expect(readFile(garbageResult.gatePath, "utf8")).resolves.toContain('"llmRan": false');
});
