import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InterviewSession, ProductDefinition } from "../src/product/contract.js";
import { buildProductPlan } from "../src/product/plan.js";
import { writeInterview } from "../src/product/store.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-product-plan-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function definition(overrides: Partial<ProductDefinition> = {}): ProductDefinition {
  return {
    idea: "项目方案聚合器",
    problem: "产品轨产物分散，没人能读到一份完整方案",
    users: ["产品经理"],
    stories: ["查看方案概览", "查看估算"],
    acceptance: ["用户能看到方案概览", "用户能看到项目估算"],
    nonGoals: ["不接 CLI"],
    ...overrides,
  };
}

async function writeDefinition(productDefinition: ProductDefinition): Promise<void> {
  const session: InterviewSession = {
    idea: productDefinition.idea,
    status: "done",
    step: 5,
    answers: [],
    definition: productDefinition,
  };
  await writeInterview(repo, session);
}

function writeProductJson(name: string, value: unknown): void {
  const productDir = join(repo, ".kunpeng", "product");
  mkdirSync(productDir, { recursive: true });
  writeFileSync(join(productDir, name), JSON.stringify(value, null, 2), "utf8");
}

test("空 repo 调用 buildProductPlan 时所有字段为 null", async () => {
  const plan = await buildProductPlan(repo);

  expect(plan.definition).toBeNull();
  expect(plan.storyMap).toBeNull();
  expect(plan.forecast).toBeNull();
  expect(plan.gate).toBeNull();
  expect(plan.discovery).toBeNull();
  expect(plan.pitch).toBeNull();
  expect(plan.validation).toBeNull();
  expect(plan.nextIteration).toBeNull();
});

test("有定义时生成 storyMap 和 forecast", async () => {
  await writeDefinition(definition());

  const plan = await buildProductPlan(repo, { seed: 1 });

  expect(plan.definition).not.toBeNull();
  expect(plan.storyMap?.backbone).toHaveLength(2);
  expect(plan.forecast).not.toBeNull();
  expect(plan.forecast?.expectedHours).toBeGreaterThan(0);
});

test("forecast 任务数来自 story map 切片任务", async () => {
  await writeDefinition(definition({ acceptance: ["用户能看到方案概览", "用户能看到项目估算"] }));

  const plan = await buildProductPlan(repo, { seed: 2 });

  expect(plan.storyMap?.slices[0]?.tasks).toHaveLength(2);
  expect(plan.forecast?.expectedHours).toBeGreaterThan(0);
});

test("draft-spec.gate.json 存在时读回 gate", async () => {
  writeProductJson("draft-spec.gate.json", {
    blocked: false,
    requiresHumanReview: false,
    concreteness: { pass: true, score: 90, issues: [] },
    critique: { verdict: "pass", deterministic: [], llm: [], llmRan: true },
  });

  const plan = await buildProductPlan(repo);

  expect(plan.gate?.concreteness.score).toBe(90);
});

test("坏 draft-spec.gate.json 时 gate 为 null 且不抛", async () => {
  const productDir = join(repo, ".kunpeng", "product");
  mkdirSync(productDir, { recursive: true });
  writeFileSync(join(productDir, "draft-spec.gate.json"), "{", "utf8");

  await expect(buildProductPlan(repo)).resolves.toMatchObject({ gate: null });
});

test("next-iteration.json 存在时读回 nextIteration", async () => {
  writeProductJson("next-iteration.json", {
    fromDecision: "persevere",
    action: "build",
    rationale: "r",
    requiresHumanGate: true,
  });

  const plan = await buildProductPlan(repo);

  expect(plan.nextIteration?.action).toBe("build");
});
