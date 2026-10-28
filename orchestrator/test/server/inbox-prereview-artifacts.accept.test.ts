import { describe, expect, it } from "vitest";
import { aggregateReviewQueue, type ProjectSnapshot } from "../../src/server/state.js";

function snap(state: unknown): ProjectSnapshot {
  return { id: "p1", name: "项目一", repoPath: "/tmp/p1", state } as unknown as ProjectSnapshot;
}

describe("收件箱 release/connector 预审透传(作者验收)", () => {
  it("release 门带 preReview → 透传到收件箱条目", () => {
    const q = aggregateReviewQueue([snap({
      humanGates: [],
      flows: [],
      artifacts: {
        release: [{ id: "rel-1", kind: "release", status: "draft", summary: "构建就绪", preReview: { verdict: "approve", reason: "构建全绿", at: 1 } }],
      },
    })]);
    const rel = q.find((i) => i.kind === "release");
    expect(rel).toBeTruthy();
    expect(rel!.preReview?.verdict).toBe("approve");
  });

  it("connector 门带 preReview → 透传;无 preReview 时为 undefined", () => {
    const q = aggregateReviewQueue([snap({
      humanGates: [],
      flows: [],
      artifacts: {
        connector: [
          { id: "c-1", kind: "connector", status: "draft", summary: "退款高风险", preReview: { verdict: "review", reason: "涉及资金,需细看", at: 2 } },
          { id: "c-2", kind: "connector", status: "draft", summary: "无预审" },
        ],
      },
    })]);
    const items = q.filter((i) => i.kind === "connector");
    expect(items.find((i) => i.id === "c-1")!.preReview?.verdict).toBe("review");
    expect(items.find((i) => i.id === "c-2")!.preReview).toBeUndefined();
  });
});
