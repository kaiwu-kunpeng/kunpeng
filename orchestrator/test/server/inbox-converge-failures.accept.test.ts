import { describe, expect, it } from "vitest";
import { aggregateReviewQueue, type ProjectSnapshot } from "../../src/server/state.js";

function snap(state: unknown): ProjectSnapshot {
  return { id: "p1", name: "项目一", repoPath: "/tmp/p1", state } as unknown as ProjectSnapshot;
}

describe("收件箱汇聚失败流 + 预审透传(作者验收)", () => {
  it("crashed/stopped → failed 条目;rolled-back 不进(遵守回归锁)", () => {
    const q = aggregateReviewQueue([snap({
      humanGates: [],
      artifacts: {},
      flows: [
        { flowId: "f1", requirement: "改登录页", status: "rolled-back", failureReason: "验证未过" },
        { flowId: "f2", requirement: "跑批任务", status: "crashed", blocker: "OOM" },
        { flowId: "f3", requirement: "被停任务", status: "stopped" },
        { flowId: "f4", requirement: "正常流", status: "running" },
      ],
    })]);
    const failed = q.filter((i) => i.kind === "failed");
    expect(failed.length).toBe(2);
    expect(failed.some((i) => i.title === "跑批任务")).toBe(true);
    expect(failed.some((i) => i.title === "被停任务")).toBe(true);
    expect(failed.some((i) => i.title === "改登录页")).toBe(false);
  });

  it("merge 门透传 preReview", () => {
    const q = aggregateReviewQueue([snap({
      humanGates: [{ flowId: "g1", what: "合并到 main", detail: "3 文件", preReview: { verdict: "approve", reason: "改动小", at: 1 } }],
      artifacts: {},
      flows: [],
    })]);
    const merge = q.find((i) => i.kind === "merge");
    expect(merge).toBeTruthy();
    expect(merge!.preReview?.verdict).toBe("approve");
  });

  it("失败流每项目最多 10 条", () => {
    const flows = Array.from({ length: 15 }, (_v, i) => ({ flowId: "f" + i, requirement: "任务" + i, status: "crashed", updatedAt: i }));
    const q = aggregateReviewQueue([snap({ humanGates: [], artifacts: {}, flows })]);
    expect(q.filter((i) => i.kind === "failed").length).toBe(10);
  });
});
