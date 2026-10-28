import { describe, it, expect } from "vitest";
import { todaySummary } from "../../src/server/today.js";

const NOW = 1_800_000_000_000;
const H = 3_600_000;

const tasks = [
  { id: "a", title: "A", status: "needs-review" },
  { id: "b", title: "B", status: "running" },
  { id: "c", title: "C", status: "verifying" },
  { id: "d", title: "D", status: "blocked", updatedAt: NOW - 1 * H },
  { id: "e", title: "E", status: "delivered", updatedAt: NOW - 2 * H },
  { id: "f", title: "F", status: "draft" },
];

describe("todaySummary（无窗口=既有行为）", () => {
  it("按待审批/在跑/阻塞/已交付分组", () => {
    const s = todaySummary({ tasks });
    expect(s.needsReview.map((t) => t.id)).toEqual(["a"]);
    expect(s.running.map((t) => t.id).sort()).toEqual(["b", "c"]);
    expect(s.blocked.map((t) => t.id)).toEqual(["d"]);
    expect(s.delivered.map((t) => t.id)).toEqual(["e"]);
  });
  it("counts 与分组一致", () => {
    const s = todaySummary({ tasks });
    expect(s.counts).toMatchObject({ needsReview: 1, running: 2, blocked: 1, delivered: 1 });
  });
  it("空输入全空", () => {
    const s = todaySummary({ tasks: [] });
    expect(s.counts).toMatchObject({ needsReview: 0, running: 0, blocked: 0, delivered: 0 });
  });
});

describe("todaySummary（带时间窗）", () => {
  const windowed = [
    { id: "old-d", status: "delivered", updatedAt: NOW - 25 * H },
    { id: "new-d", status: "delivered", updatedAt: NOW - 1 * H },
    { id: "old-b", status: "blocked", updatedAt: NOW - 48 * H },
    { id: "new-b", status: "blocked", updatedAt: NOW - 2 * H },
    { id: "no-ts", status: "delivered" },
    { id: "old-r", status: "needs-review", updatedAt: NOW - 100 * H },
    { id: "run", status: "running", updatedAt: NOW - 100 * H },
  ];
  it("delivered 只留窗口内，blocked 不受窗口影响", () => {
    const s = todaySummary({ tasks: windowed, now: NOW, windowMs: 24 * H });
    expect(s.delivered.map((t) => t.id)).toEqual(["new-d"]);
    expect(s.blocked.map((t) => t.id)).toEqual(["old-b", "new-b"]);
    expect(s.counts.delivered).toBe(1);
    expect(s.counts.blocked).toBe(2);
  });
  it("缺 updatedAt 的 delivered 在窗口模式下被排除", () => {
    const s = todaySummary({ tasks: windowed, now: NOW, windowMs: 24 * H });
    expect(s.delivered.find((t) => t.id === "no-ts")).toBeUndefined();
  });
  it("needsReview/running 不受窗口影响", () => {
    const s = todaySummary({ tasks: windowed, now: NOW, windowMs: 24 * H });
    expect(s.needsReview.map((t) => t.id)).toEqual(["old-r"]);
    expect(s.running.map((t) => t.id)).toEqual(["run"]);
  });
});
