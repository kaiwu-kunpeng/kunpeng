import { expect, test } from "vitest";
import { flowBlockers, flowHumanGates } from "../src/server/state.js";

type FlowLike = { flowId: string; status: string; stage: string; humanGate?: { gate: string; what: string }; blocker?: string };

const flows: FlowLike[] = [
  { flowId: "merge-1", status: "verified", stage: "done", humanGate: { gate: "合并主干 (人工门#1)", what: "kp/x → main" } },
  { flowId: "ops-1", status: "rolled-back", stage: "done", humanGate: { gate: "运营 loop 对外推送", what: "wechat-sweep" } },
  { flowId: "ops-2", status: "rolled-back", stage: "done", humanGate: { gate: "运营 loop 波前护栏", what: "[sensitive] 敏感波" } },
  { flowId: "run-1", status: "running", stage: "implement", blocker: "等待输入" },
  { flowId: "crash-1", status: "crashed", stage: "verify", blocker: "崩溃：need attention" },
  { flowId: "stop-1", status: "stopped", stage: "spec", blocker: "误触发：已人工终止清理，无产出" },
  { flowId: "rb-blk", status: "rolled-back", stage: "done", blocker: "回滚残留" },
];

test("flowHumanGates 只收 verified 流上的门——回滚流(运营 loop 残留门)必须被剔除", () => {
  const gates = flowHumanGates(flows as never);
  expect(gates.map((g) => g.flowId)).toEqual(["merge-1"]);
  expect(gates[0]?.what).toBe("合并主干 (人工门#1)");
});

test("flowBlockers 只收 running/crashed 的阻塞——stopped/rolled-back(终态残留)必须被剔除", () => {
  const blockers = flowBlockers(flows as never);
  expect(blockers.map((b) => b.flowId).sort()).toEqual(["crash-1", "run-1"]);
});

test("无门/无阻塞时返回空数组", () => {
  expect(flowHumanGates([])).toEqual([]);
  expect(flowBlockers([])).toEqual([]);
  expect(flowHumanGates([{ flowId: "v", status: "verified", stage: "done" } as never])).toEqual([]);
  expect(flowBlockers([{ flowId: "r", status: "running", stage: "x" } as never])).toEqual([]);
});