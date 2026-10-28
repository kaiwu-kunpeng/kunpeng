import { describe, it, expect } from "vitest";
import {
  statusBadge,
  buildVerdictLine,
  buildNeedsYou,
  buildProjectRollup,
} from "../../src/cockpit/action-home.js";

describe("statusBadge 固定词表", () => {
  it("各状态映射到一态一标签", () => {
    expect(statusBadge("verified")).toEqual({ label: "已验", tone: "done" });
    expect(statusBadge("rolled-back").tone).toBe("failed");
    expect(statusBadge("blocked").tone).toBe("needs-input");
    expect(statusBadge("running").tone).toBe("running");
    expect(statusBadge("paused").tone).toBe("idle");
  });
});

describe("buildVerdictLine", () => {
  it("无门无失败时给安心空状态", () => {
    expect(buildVerdictLine({ gates: 0, failed: 0, running: 3 })).toBe(
      "一切自动运行中,无需你介入（3 条流在跑）",
    );
  });
  it("有门有失败时拼裁决句", () => {
    const line = buildVerdictLine({ gates: 2, failed: 1, running: 5 });
    expect(line).toContain("2 条待你拍板");
    expect(line).toContain("1 条失败需复盘");
    expect(line).toContain("其余 5 条自动运行中");
    expect(line).toContain(" · ");
  });
});

describe("buildNeedsYou", () => {
  it("门优先、再失败、再卡住,且带 AI 预审", () => {
    const q = buildNeedsYou({
      humanGates: [{ what: "合并 X", detail: "改了 a.ts", flowId: "g1", preReview: { verdict: "approve", reason: "纯加性" } }],
      failures: [{ flowId: "f1", requirement: "做 Y", reason: "测试红" }],
      blockers: [{ flowId: "b1", stage: "verify", reason: "缺 fixture" }],
    });
    expect(q.map((i) => i.kind)).toEqual(["gate", "failed", "blocked"]);
    expect(q[0]).toMatchObject({ kind: "gate", title: "合并 X", tone: "needs-review" });
    expect(q[0].prereview).toEqual({ verdict: "approve", reason: "纯加性" });
    expect(q[1]).toMatchObject({ kind: "failed", title: "做 Y", tone: "failed" });
    expect(q[2]).toMatchObject({ kind: "blocked", tone: "needs-input" });
    expect(q[2].detail).toContain("verify");
  });
  it("无 preReview 不带该字段", () => {
    const q = buildNeedsYou({ humanGates: [{ what: "x", detail: "y", flowId: "g" }], failures: [], blockers: [] });
    expect(q[0].prereview).toBeUndefined();
  });
});

describe("buildProjectRollup", () => {
  it("最坏态上卷 + 在跑计数 + 按名排序", () => {
    const r = buildProjectRollup([
      { project: "beta", status: "running" },
      { project: "alpha", status: "verified" },
      { project: "alpha", status: "rolled-back" },
      { project: "beta", status: "implement" },
    ]);
    expect(r.map((x) => x.project)).toEqual(["alpha", "beta"]);
    expect(r.find((x) => x.project === "alpha")!.tone).toBe("red");
    expect(r.find((x) => x.project === "beta")!.tone).toBe("green");
    expect(r.find((x) => x.project === "beta")!.running).toBe(2);
  });
  it("有 block 无 fail 时为黄", () => {
    expect(buildProjectRollup([{ project: "p", status: "blocked" }])[0].tone).toBe("yellow");
  });
});