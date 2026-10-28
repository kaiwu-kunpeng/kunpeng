import { expect, test } from "vitest";
import { deriveFlowSignals, flowLevel } from "../../src/metrics/flow-level.js";

test("autonomous short flow with no human gates -> L3", () => {
  const flow = {
    requirement: "加登录页",
    elapsedMs: 120000,
    history: [{ stage: "spec" }, { stage: "implement" }, { stage: "verify" }],
  };
  const sig = deriveFlowSignals(flow);
  expect(sig.userMsgs).toBe(1);          // 无 gate 触点
  expect(sig.userChars).toBe("加登录页".length);
  expect(sig.durationMin).toBeCloseTo(2, 6);
  expect(flowLevel(flow)).toBe("L3");
});

test("many human-gate touches push msgs up -> L1", () => {
  const history = Array.from({ length: 8 }, () => ({ stage: "gate-cleared" }));
  const flow = { requirement: "r", elapsedMs: 0, history };
  expect(deriveFlowSignals(flow).userMsgs).toBe(9);  // 1 + 8 gate 触点
  expect(flowLevel(flow)).toBe("L1");
});

test("very long requirement -> L1 by chars", () => {
  const flow = { requirement: "x".repeat(2500), history: [] };
  expect(deriveFlowSignals(flow).userChars).toBe(2500);
  expect(flowLevel(flow)).toBe("L1");
});

test("supervised flow with a couple gates -> L2", () => {
  const flow = {
    requirement: "中等长度需求".repeat(60), // ~360 chars < 400
    history: [{ stage: "implement" }, { stage: "blocker-cleared" }, { stage: "gate-cleared" }, { stage: "verify" }],
  };
  // userMsgs = 1 + 2 = 3 (3..7区间), userChars < 400 -> L2
  expect(flowLevel(flow)).toBe("L2");
});

test("empty flow defaults safely to L3", () => {
  expect(flowLevel({})).toBe("L3");
});