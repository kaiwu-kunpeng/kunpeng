import { describe, expect, it } from "vitest";
import { aggregateReviewQueue, STALE_FAILED_FLOW_MS, type ProjectSnapshot } from "../../src/server/state.js";

const DAY = 24 * 60 * 60 * 1000;
function snap(state: unknown): ProjectSnapshot {
  return { id: "p1", name: "项目一", repoPath: "/tmp/p1", state } as unknown as ProjectSnapshot;
}

describe("收件箱失败段自动老化(作者验收)", () => {
  it("STALE_FAILED_FLOW_MS 等于 7 天", () => {
    expect(STALE_FAILED_FLOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("传 now: 8 天前 stopped 老化掉,1 天前 stopped 保留", () => {
    const now = 1_000_000_000_000;
    const q = aggregateReviewQueue([snap({
      humanGates: [], artifacts: {},
      flows: [
        { flowId: "old", requirement: "废弃停流", status: "stopped", updatedAt: now - 8 * DAY },
        { flowId: "fresh", requirement: "新近停流", status: "stopped", updatedAt: now - 1 * DAY },
      ],
    })], { now });
    const failed = q.filter((i) => i.kind === "failed");
    expect(failed.some((i) => i.id === "old")).toBe(false);
    expect(failed.some((i) => i.id === "fresh")).toBe(true);
  });

  it("不传 opts: 8 天前 stopped 仍保留(向后兼容)", () => {
    const now = 1_000_000_000_000;
    const q = aggregateReviewQueue([snap({
      humanGates: [], artifacts: {},
      flows: [{ flowId: "old", requirement: "废弃停流", status: "stopped", updatedAt: now - 8 * DAY }],
    })]);
    expect(q.filter((i) => i.kind === "failed").some((i) => i.id === "old")).toBe(true);
  });

  it("传 now 但缺 updatedAt: 保留(无法判龄不误杀)", () => {
    const now = 1_000_000_000_000;
    const q = aggregateReviewQueue([snap({
      humanGates: [], artifacts: {},
      flows: [{ flowId: "noage", requirement: "无时间戳停流", status: "stopped" }],
    })], { now });
    expect(q.filter((i) => i.kind === "failed").some((i) => i.id === "noage")).toBe(true);
  });

  it("crashed 同样老化: 8 天前 crashed + now → 不出现", () => {
    const now = 1_000_000_000_000;
    const q = aggregateReviewQueue([snap({
      humanGates: [], artifacts: {},
      flows: [{ flowId: "c", requirement: "旧崩溃流", status: "crashed", updatedAt: now - 8 * DAY }],
    })], { now });
    expect(q.filter((i) => i.kind === "failed").length).toBe(0);
  });

  it("blocked 段不受 now 影响", () => {
    const now = 1_000_000_000_000;
    const q = aggregateReviewQueue([snap({
      humanGates: [], artifacts: {}, flows: [],
      blockers: [{ flowId: "b1", reason: "等待人工输入", stage: "implement" }],
    })], { now });
    expect(q.filter((i) => i.kind === "blocked").length).toBe(1);
  });
});
