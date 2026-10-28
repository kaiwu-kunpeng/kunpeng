import { describe, expect, it } from "vitest";
import { computeSystemLight, isReviewFindingOpen } from "../../src/server/state-dashboard-slim.js";
import type { ArtifactSummary } from "../../src/artifacts/store.js";
import type { FlowState } from "../../src/runtime/flowstate.js";

function flow(status: FlowState["status"]): FlowState {
  return {
    flowId: `flow-${status}`,
    requirement: "test",
    stage: "done",
    status,
    agentActive: false,
    startedAt: 1,
    updatedAt: 2,
    history: [],
  };
}

function review(status: ArtifactSummary["status"], findings: unknown[]): ArtifactSummary {
  return {
    kind: "review",
    id: `review-${status}-${findings.length}`,
    status,
    summary: "review",
    meta: { findings },
  };
}

describe("isReviewFindingOpen", () => {
  it("非终态产物 + warn + 无 resolution → 未收口", () => {
    expect(isReviewFindingOpen("draft", { severity: "warn" })).toBe(true);
    expect(isReviewFindingOpen("approved", { severity: "error" })).toBe(true);
  });

  it("severity 不是 warn/error → 一律已收口", () => {
    expect(isReviewFindingOpen("draft", { severity: "info" })).toBe(false);
    expect(isReviewFindingOpen("draft", {})).toBe(false);
    expect(isReviewFindingOpen("draft", null)).toBe(false);
    expect(isReviewFindingOpen("draft", "warn")).toBe(false);
  });

  it("产物已终态(verified / rolled-back)→ 其发现不再算未收口", () => {
    expect(isReviewFindingOpen("verified", { severity: "warn" })).toBe(false);
    expect(isReviewFindingOpen("rolled-back", { severity: "error" })).toBe(false);
  });

  it("finding 带非空 resolution → 已收口;空白 resolution 不算", () => {
    expect(isReviewFindingOpen("draft", { severity: "warn", resolution: "候选分支保留作者原 spec" })).toBe(false);
    expect(isReviewFindingOpen("draft", { severity: "warn", resolution: "   " })).toBe(true);
    expect(isReviewFindingOpen("draft", { severity: "warn", resolution: "" })).toBe(true);
  });
});

describe("computeSystemLight 与已解决发现", () => {
  it("线上真实形状:两份 verified 产物 + 带 resolution 的 warn → 绿灯", () => {
    const arts = [
      review("verified", [{
        severity: "warn",
        file: "docs/specs/2026-08-05-chat-p0b-immutable-account-identity.md",
        issue: "机器 spec 留档覆盖作者契约",
        resolution: "候选分支保留作者原 spec",
      }]),
      review("verified", [{
        severity: "warn",
        file: "orchestrator/specs/2026-08-06-chat-p1-sensitive-history-and-remote-default.spec.md",
        issue: "原始集成分支包含 scope 外机器 spec 副本",
        resolution: "resolved 候选已移除 .md/.html 两份机器副本，保留作者契约",
      }]),
    ];
    expect(computeSystemLight([flow("verified")], arts)).toBe("green");
  });

  it("未收口的 warn(draft + 无 resolution)仍然压黄", () => {
    expect(computeSystemLight([flow("verified")], [review("draft", [{ severity: "warn" }])])).toBe("yellow");
  });

  it("已收口的 warn 与未收口的 warn 同时存在 → 仍然黄(不漏真告警)", () => {
    const arts = [
      review("verified", [{ severity: "warn", resolution: "已修" }]),
      review("draft", [{ severity: "error" }]),
    ];
    expect(computeSystemLight([flow("verified")], arts)).toBe("yellow");
  });

  it("红灯优先级不受影响", () => {
    expect(computeSystemLight([flow("crashed")], [review("verified", [{ severity: "warn", resolution: "已修" }])])).toBe("red");
  });
});