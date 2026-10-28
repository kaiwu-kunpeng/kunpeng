import { describe, expect, it } from "vitest";
import { aggregateReviewQueue, type ProjectSnapshot } from "../../src/server/state.js";

function snap(state: unknown): ProjectSnapshot {
  return { id: "p1", name: "P", repoPath: "/tmp/p", state } as unknown as ProjectSnapshot;
}

describe("收件箱汇聚卡点流(作者验收)", () => {
  it("blockers → kind:blocked 条目,title 为 reason", () => {
    const q = aggregateReviewQueue([snap({
      humanGates: [], flows: [], artifacts: {},
      blockers: [
        { flowId: "f1", stage: "implement", reason: "审计未过·等人工确认" },
        { flowId: "f2", stage: "verify", reason: "超时卡住" },
      ],
    })]);
    const blocked = q.filter((i) => i.kind === "blocked");
    expect(blocked.length).toBe(2);
    expect(blocked.some((i) => i.title === "审计未过·等人工确认")).toBe(true);
    expect(blocked.find((i) => i.id === "f1")!.detail).toContain("implement");
  });

  it("卡点每项目最多 10 条", () => {
    const blockers = Array.from({ length: 14 }, (_v, i) => ({ flowId: "f" + i, stage: "s", reason: "卡" + i }));
    const q = aggregateReviewQueue([snap({ humanGates: [], flows: [], artifacts: {}, blockers })]);
    expect(q.filter((i) => i.kind === "blocked").length).toBe(10);
  });
});
