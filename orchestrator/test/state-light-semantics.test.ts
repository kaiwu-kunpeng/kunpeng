import { expect, test } from "vitest";
import { computeSystemLight } from "../src/server/state.js";
import type { ArtifactSummary } from "../src/artifacts/store.js";
import type { FlowState } from "../src/runtime/flowstate.js";

function flow(status: FlowState["status"], blocker?: string): FlowState {
  return {
    flowId: `${status}-${blocker ?? "ok"}`,
    requirement: "test",
    stage: "done",
    status,
    agentActive: false,
    ...(blocker ? { blocker } : {}),
    startedAt: 1,
    updatedAt: 2,
    history: [],
  };
}

function reviewWithSeverity(severity: string): ArtifactSummary {
  return {
    kind: "review",
    id: `review-${severity}`,
    status: "draft",
    summary: "review",
    meta: { findings: [{ severity }] },
  };
}

test("all verified flows without warn/error review keep system light green", () => {
  expect(computeSystemLight([flow("verified"), flow("verified")], [])).toBe("green");
});

test("crashed flow makes system light red", () => {
  expect(computeSystemLight([flow("verified"), flow("crashed")], [])).toBe("red");
});

test("running flow with blocker makes system light red", () => {
  expect(computeSystemLight([flow("verified"), flow("running", "blocked")], [])).toBe("red");
});

test("rolled-back flow keeps system light green (回滚=正确自愈, 不告警)", () => {
  expect(computeSystemLight([flow("verified"), flow("rolled-back")], [])).toBe("green");
});

test("rolled-back terminal flow with stale blocker stays green, not red/yellow", () => {
  expect(computeSystemLight([flow("verified"), flow("rolled-back", "historical blocker")], [])).toBe("green");
});

test("review error finding makes verified flows yellow", () => {
  expect(computeSystemLight([flow("verified"), flow("verified")], [reviewWithSeverity("error")])).toBe("yellow");
});

test("review warn finding makes verified flows yellow", () => {
  expect(computeSystemLight([flow("verified")], [reviewWithSeverity("warn")])).toBe("yellow");
});

test("review info finding does not raise light (stays green)", () => {
  expect(computeSystemLight([flow("verified")], [reviewWithSeverity("info")])).toBe("green");
});

test("crashed takes priority over rolled-back (red wins)", () => {
  expect(computeSystemLight([flow("rolled-back"), flow("crashed")], [])).toBe("red");
});

test("crashed takes priority over review error (red wins)", () => {
  expect(computeSystemLight([flow("crashed")], [reviewWithSeverity("error")])).toBe("red");
});

test("stopped flow with blocker does not raise system light to red (用户主动终态)", () => {
  // stopped 带 blocker 不顶红（非 running、非 crashed）；其原因经 blockers 面板可见, janitor 也不会清。
  expect(computeSystemLight([flow("verified"), flow("stopped", "审计未通过")], [])).toBe("green");
});
