import { describe, expect, it } from "vitest";

import { pickCrashedResumes } from "./autopilot.js";

describe("crashed 流自动 resume 挑选", () => {
  it("只挑 crashed 且未超重试上限的流", () => {
    const flows = [
      { flowId: "a", status: "crashed" as const },
      { flowId: "b", status: "running" as const },
      { flowId: "c", status: "crashed" as const, resumeAttempts: 2 },
      { flowId: "d", status: "verified" as const },
    ];
    expect(pickCrashedResumes(flows)).toEqual(["a"]);
  });

  it("默认上限 2 次:已试 1 次可再试,已试 2 次不再试", () => {
    expect(pickCrashedResumes([{ flowId: "x", status: "crashed" as const, resumeAttempts: 1 }])).toEqual(["x"]);
    expect(pickCrashedResumes([{ flowId: "x", status: "crashed" as const, resumeAttempts: 2 }])).toEqual([]);
  });

  it("每轮限量防 resume 风暴:默认最多 2 条,可配置", () => {
    const flows = ["a", "b", "c", "d"].map((id) => ({ flowId: id, status: "crashed" as const }));
    expect(pickCrashedResumes(flows)).toEqual(["a", "b"]);
    expect(pickCrashedResumes(flows, { perCycle: 3 })).toEqual(["a", "b", "c"]);
    expect(pickCrashedResumes(flows, { maxAttempts: 0 })).toEqual([]);
  });
});