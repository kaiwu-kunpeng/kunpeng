import { expect, test } from "vitest";
import { runAutopilot } from "../src/loop/autopilot.js";
import { GUARDIAN_REINJECT_PREFIX } from "../src/feedback/finding-to-task.js";
import type { FlowState, FlowTracker } from "../src/runtime/flowstate.js";

function gate(): { gate: string; what: string } {
  return { gate: "合并主干 (人工门#1)", what: "kp/x → main" };
}

test("autopilot 跳过守护来源流、仍自动合普通验证流", async () => {
  const flows: FlowState[] = [
    {
      flowId: "feat-real",
      requirement: "给 PtySessionPool 加会话上限",
      stage: "done",
      status: "verified",
      agentActive: false,
      humanGate: gate(),
      startedAt: 1,
      updatedAt: 2,
      history: [],
    },
    {
      flowId: "lint-churn",
      requirement: `${GUARDIAN_REINJECT_PREFIX}（lint/error）：src/x.ts:5 no-empty。只改代码消除该问题，不要改验收命令。`,
      stage: "done",
      status: "verified",
      agentActive: false,
      humanGate: gate(),
      startedAt: 1,
      updatedAt: 2,
      history: [],
    },
  ];
  const tracker = { list: async () => flows } as unknown as FlowTracker;
  const calls: string[] = [];

  const result = await runAutopilot({
    tracker,
    merge: async (flowId) => {
      calls.push(flowId);
      return { ok: true };
    },
  });

  // 守护来源流绝不被调用 merge
  expect(calls).toEqual(["feat-real"]);
  expect(result.merged).toEqual(["feat-real"]);
  // 守护流被跳过且原因点明人工
  const skipped = result.skipped.find((s) => s.flowId === "lint-churn");
  expect(skipped).toBeDefined();
  expect(skipped!.reason).toMatch(/守护|人工/);
});

test("全部为守护来源时 autopilot 一个都不合", async () => {
  const flows: FlowState[] = [
    {
      flowId: "lint-a",
      requirement: `${GUARDIAN_REINJECT_PREFIX}（lint/error）：src/a.ts:1 no-empty`,
      stage: "done",
      status: "verified",
      agentActive: false,
      humanGate: gate(),
      startedAt: 1,
      updatedAt: 2,
      history: [],
    },
  ];
  const tracker = { list: async () => flows } as unknown as FlowTracker;
  const calls: string[] = [];
  const result = await runAutopilot({ tracker, merge: async (f) => { calls.push(f); return { ok: true }; } });

  expect(calls).toEqual([]);
  expect(result.merged).toEqual([]);
  expect(result.skipped.map((s) => s.flowId)).toEqual(["lint-a"]);
});