import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArtifactStore } from "../../src/artifacts/store.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { summarizeCost } from "../../src/runtime/cost-metrics";
import { aggregateStageTokens, collectState, flowsToStageCosts, stageIsLlm } from "../../src/server/state.js";

const flows = [
  {
    history: [
      { stage: "spec", at: 1 },
      { stage: "verify", at: 2 },
    ],
  },
  {
    history: [
      { stage: "implement", at: 3 },
      { stage: "verify", at: 4 },
      { stage: "commit", at: 5 },
    ],
  },
];

test("stageIsLlm classifies LLM stages explicitly", () => {
  expect(stageIsLlm("implement")).toBe(true);
  expect(stageIsLlm("spec")).toBe(true);

  expect(stageIsLlm("verify")).toBe(false);
  expect(stageIsLlm("audit")).toBe(false);
  expect(stageIsLlm("merge")).toBe(false);
});

test("flowsToStageCosts maps flow history to stage costs without tokens", () => {
  const costs = flowsToStageCosts(flows);

  expect(costs).toHaveLength(5);
  expect(costs.filter((cost) => cost.llm)).toEqual([
    { stage: "spec", llm: true },
    { stage: "implement", llm: true },
  ]);
  for (const cost of costs) {
    expect(cost).not.toHaveProperty("tokens");
  }
});

test("summarizeCost aggregates costs from flow history", () => {
  expect(summarizeCost(flowsToStageCosts(flows))).toEqual({
    totalStages: 5,
    llmStages: 2,
    deterministicStages: 3,
    determinismRatio: 0.6,
    savedLlmCalls: 3,
    totalTokens: 0,
  });
});

test("flowsToStageCosts accepts missing and empty history", () => {
  expect(() => flowsToStageCosts([{}])).not.toThrow();
  expect(() => flowsToStageCosts([{ history: [] }])).not.toThrow();

  expect(flowsToStageCosts([{}])).toEqual([]);
  expect(flowsToStageCosts([{ history: [] }])).toEqual([]);
});

test("flowsToStageCosts does not mutate input flows or history items", () => {
  const input = structuredClone(flows);
  const before = structuredClone(input);

  flowsToStageCosts(input);

  expect(input).toEqual(before);
});

test("aggregateStageTokens sums stage token maps and ignores invalid values", () => {
  expect(
    aggregateStageTokens([
      { stageTokens: { spec: 100, implement: 500 } },
      { stageTokens: { implement: 300 } },
    ]),
  ).toEqual({ spec: 100, implement: 800 });

  expect(aggregateStageTokens([])).toEqual({});
  expect(aggregateStageTokens([{}])).toEqual({});
  expect(aggregateStageTokens([{ stageTokens: {} }])).toEqual({});
  expect(
    aggregateStageTokens([
      { stageTokens: { spec: 100, implement: -1, repair: NaN, review: Infinity } },
    ]),
  ).toEqual({ spec: 100 });
});

test("collectState costSummary totalTokens comes from persisted flow tokens", async () => {
  const repo = mkdtempSync(join(tmpdir(), "kp-cost-"));
  try {
    const tracker = new FlowTracker(join(repo, ".kunpeng", "state"));
    await tracker.start("f1", "one");
    await tracker.enter("f1", "verify", false);
    await tracker.addTokens("f1", 1000);
    await tracker.addStageTokens("f1", "spec", 800);
    await tracker.start("f2", "two");
    await tracker.enter("f2", "implement", true);
    await tracker.enter("f2", "verify", false);
    await tracker.addTokens("f2", 540);
    await tracker.addStageTokens("f2", "spec", 200);
    await tracker.addStageTokens("f2", "implement", 300);

    const state = await collectState(new ArtifactStore(join(repo, ".kunpeng", "artifacts")), repo);

    expect(state.costSummary).toMatchObject({
      totalStages: 5,
      llmStages: 3,
      deterministicStages: 2,
      determinismRatio: 0.4,
      savedLlmCalls: 2,
      totalTokens: 1540,
      tokensByStage: { spec: 1000, implement: 300 },
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
