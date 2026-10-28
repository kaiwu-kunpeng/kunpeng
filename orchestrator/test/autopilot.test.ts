import { expect, test } from "vitest";
import { runAutopilot } from "../src/loop/autopilot.js";
import type { FlowState, FlowTracker } from "../src/runtime/flowstate.js";

test("runAutopilot only merges verified flows with merge human gate", async () => {
  const flows: FlowState[] = [
    {
      flowId: "flow1",
      requirement: "flow one",
      stage: "done",
      status: "verified",
      agentActive: false,
      humanGate: { gate: "合并主干 (人工门#1)", what: "kp/flow1 → main" },
      startedAt: 1,
      updatedAt: 2,
      history: [],
    },
    {
      flowId: "flow2",
      requirement: "flow two",
      stage: "done",
      status: "verified",
      agentActive: false,
      humanGate: { gate: "合并主干 (人工门#1)", what: "kp/flow2 → main" },
      startedAt: 1,
      updatedAt: 2,
      history: [],
    },
    {
      flowId: "flow3",
      requirement: "running flow",
      stage: "implement",
      status: "running",
      agentActive: true,
      startedAt: 1,
      updatedAt: 2,
      history: [],
    },
    {
      flowId: "flow4",
      requirement: "no gate",
      stage: "done",
      status: "verified",
      agentActive: false,
      startedAt: 1,
      updatedAt: 2,
      history: [],
    },
  ];
  const tracker = { list: async () => flows } as unknown as FlowTracker;
  const calls: [string, string][] = [];

  const result = await runAutopilot({
    tracker,
    merge: async (flowId, base) => {
      calls.push([flowId, base]);
      if (flowId === "flow1") return { ok: true };
      return { ok: false, error: "审查闸拦截" };
    },
  });

  expect(result.merged).toEqual(["flow1"]);
  expect(result.skipped).toHaveLength(1);
  expect(result.skipped[0]).toMatchObject({ flowId: "flow2" });
  expect(result.skipped[0].reason).toContain("审查闸");

  const touched = [...result.merged, ...result.skipped.map((item) => item.flowId)];
  expect(touched).not.toContain("flow3");
  expect(touched).not.toContain("flow4");
  expect(calls).toContainEqual(["flow1", "main"]);
  expect(calls.map(([flowId]) => flowId)).toEqual(["flow1", "flow2"]);
});
