import { expect, test } from "vitest";
import type { ProductValidation, ShapedPitch } from "../src/product/contract.js";
import { closeValidationLoop } from "../src/product/loop-close.js";

const pitch: ShapedPitch = {
  title: "X",
  appetite: "2 days",
  problem: "P",
  solution: "S",
  buildScope: ["scope"],
  rabbitHoles: [],
  noGos: [],
  successMetrics: ["metric"],
};

function validationFixture(overrides: Partial<ProductValidation>): ProductValidation {
  return {
    hypotheses: ["h"],
    signals: [{ source: "customer", kind: "interview", summary: "s", synthetic: false }],
    decision: "inconclusive",
    rationale: "r",
    requiresHumanGate: false,
    ...overrides,
  };
}

test("persevere→build", () => {
  const validation = validationFixture({ decision: "persevere", requiresHumanGate: true });

  const result = closeValidationLoop(validation, pitch);

  expect(result.action).toBe("build");
  expect(result.rationale).toContain("X");
  expect(result.nextSeed).toBeUndefined();
  expect(result.requiresHumanGate).toBe(true);
});

test("pivot→给迭代种子", () => {
  const validation = validationFixture({ decision: "pivot", rationale: "用户不愿付费" });

  const result = closeValidationLoop(validation, pitch);

  expect(result.action).toBe("pivot");
  expect(result.nextSeed).toContain("P");
  expect(result.nextSeed).toContain("用户不愿付费");
  expect(result.requiresHumanGate).toBe(true);
});

test("inconclusive→采信号", () => {
  const validation = validationFixture({ decision: "inconclusive", rationale: "缺真实信号；..." });

  const result = closeValidationLoop(validation, pitch);

  expect(result.action).toBe("gather-signals");
  expect(result.rationale).toContain("信号");
  expect(result.nextSeed).toBeUndefined();
});

test("fromDecision 透传", () => {
  const validation = validationFixture({ decision: "pivot" });

  const result = closeValidationLoop(validation, pitch);

  expect(result.fromDecision).toBe(validation.decision);
});
