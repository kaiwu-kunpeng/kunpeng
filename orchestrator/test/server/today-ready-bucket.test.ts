import { clientSource } from "../helpers/client-source.js";
import { describe, it, expect } from "vitest";
import { todaySummary } from "../../src/server/today.js";

describe("今日面板 ready 桶", () => {
  it("draft 与 ready 任务进 ready 桶并计数", () => {
    const summary = todaySummary({
      tasks: [
        { id: "t1", title: "落地任务A", status: "ready", source: "store", updatedAt: 1 },
        { id: "t2", title: "草稿任务B", status: "draft", source: "store", updatedAt: 2 },
        { id: "t3", title: "在跑任务C", status: "running", source: "flow", updatedAt: 3 },
      ],
    });
    expect(summary.ready.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(summary.counts.ready).toBe(2);
    expect(summary.running.map((t) => t.id)).toEqual(["t3"]);
  });

  it("ready 桶同题去重保留最新", () => {
    const summary = todaySummary({
      tasks: [
        { id: "a", title: "同题", status: "ready", source: "store", updatedAt: 1 },
        { id: "b", title: "同题", status: "ready", source: "store", updatedAt: 9 },
      ],
    });
    expect(summary.ready).toHaveLength(1);
    expect(summary.ready[0].id).toBe("b");
    expect(summary.ready[0].dupCount).toBe(2);
  });

  it("client 源码 渲染了就绪桶（源码级断言）", () => {
    const src = clientSource();
    expect(src).toContain("就绪");
    expect(src).toContain("data.ready");
  });
});