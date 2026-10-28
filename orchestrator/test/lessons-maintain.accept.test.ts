import { describe, expect, it } from "vitest";
import { planMaintainLessons } from "../src/cli.js";
import type { LessonEntry } from "../src/knowledge/lesson-store.js";

const L = (over: Partial<LessonEntry> = {}): LessonEntry => ({
  id: "l", title: "t", description: "d", content: "c", polarity: "failure",
  evidence: "e", sourceIds: ["s"], trustTier: 1, stats: { injected: 0, wins: 0, losses: 0 }, createdAt: 1, ...over,
});

describe("maintain 失败复利策略(作者验收)", () => {
  it("只取 merges,毕业/退役只计数", () => {
    const a = L({ id: "a", title: "同题", content: "同", createdAt: 1 });
    const b = L({ id: "b", title: "同题", content: "同", createdAt: 5 });
    const win = L({ id: "w", stats: { injected: 3, wins: 3, losses: 0 } });
    const dead = L({ id: "d", stats: { injected: 6, wins: 0, losses: 0 } });
    const r = planMaintainLessons([a, b, win, dead]);
    expect(r.merges.length).toBe(1);
    expect(r.graduateCount).toBeGreaterThanOrEqual(1);
    expect(r.retireCount).toBeGreaterThanOrEqual(1);
  });
  it("空输入零动作", () => {
    const r = planMaintainLessons([]);
    expect(r.merges.length).toBe(0);
    expect(r.graduateCount).toBe(0);
    expect(r.retireCount).toBe(0);
  });
});
