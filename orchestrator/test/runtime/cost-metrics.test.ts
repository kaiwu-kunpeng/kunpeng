import { expect, test } from "vitest";

import {
  formatCostSummary,
  summarizeCost,
  type StageCost,
} from "../../src/runtime/cost-metrics";

test("summarizeCost aggregates LLM and deterministic stage costs", () => {
  expect(
    summarizeCost([
      { stage: "spec", llm: true, tokens: 1000 },
      { stage: "parse", llm: false },
      { stage: "impl", llm: true, tokens: 2000 },
      { stage: "merge", llm: false },
    ]),
  ).toEqual({
    totalStages: 4,
    llmStages: 2,
    deterministicStages: 2,
    totalTokens: 3000,
    determinismRatio: 0.5,
    savedLlmCalls: 2,
  });
});

test("summarizeCost reports full determinism when every stage avoids LLM", () => {
  expect(
    summarizeCost([
      { stage: "parse", llm: false },
      { stage: "merge", llm: false },
    ]),
  ).toMatchObject({
    llmStages: 0,
    deterministicStages: 2,
    determinismRatio: 1,
    savedLlmCalls: 2,
  });
});

test("summarizeCost handles empty input without throwing", () => {
  expect(summarizeCost([])).toEqual({
    totalStages: 0,
    llmStages: 0,
    deterministicStages: 0,
    totalTokens: 0,
    determinismRatio: 0,
    savedLlmCalls: 0,
  });
});

test("formatCostSummary includes stages, determinism percentage, saved calls, and tokens", () => {
  const text = formatCostSummary({
    totalStages: 4,
    llmStages: 2,
    deterministicStages: 2,
    totalTokens: 3000,
    determinismRatio: 0.5,
    savedLlmCalls: 2,
  });

  expect(text).toContain("4 阶段");
  expect(text).toContain("2 走 LLM");
  expect(text).toContain("2 确定性");
  expect(text).toContain("省 2 次 LLM");
  expect(text).toContain("确定性占 50%");
  expect(text).toContain("3000 tokens");
});

test("summarizeCost does not mutate the input array or stage objects", () => {
  const stages: StageCost[] = [
    { stage: "spec", llm: true, tokens: 1000 },
    { stage: "parse", llm: false },
  ];
  const before = structuredClone(stages);

  summarizeCost(stages);

  expect(stages).toEqual(before);
});
