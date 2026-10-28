import { describe, expect, it } from "vitest";
import { lessonSimilarity, planConsolidation, applyMerges } from "../src/knowledge/lesson-consolidate.js";
import type { LessonEntry } from "../src/knowledge/lesson-store.js";

const L = (over: Partial<LessonEntry> = {}): LessonEntry => ({
  id: "l", title: "t", description: "d", content: "c", polarity: "failure",
  evidence: "e", sourceIds: ["s"], trustTier: 1, stats: { injected: 0, wins: 0, losses: 0 },
  createdAt: 1, ...over,
});

describe("Lesson 整编(作者验收)", () => {
  it("同签名相似度 1.0", () => {
    expect(lessonSimilarity(L({ signature: "x" }), L({ signature: "x", title: "别的" }))).toBe(1);
  });
  it("近似合并保最新、并 sourceIds", () => {
    const a = L({ id: "a", title: "scope 块逐行 allow", content: "YAML 列表静默为空", createdAt: 1, sourceIds: ["f1"] });
    const b = L({ id: "b", title: "scope 块逐行 allow", content: "YAML 列表静默为空", createdAt: 5, sourceIds: ["f2"] });
    const plan = planConsolidation([a, b]);
    expect(plan.merges.length).toBe(1);
    expect(plan.merges[0]!.keep).toBe("b");
    expect(plan.merges[0]!.drop).toContain("a");
    const applied = applyMerges([a, b], plan.merges);
    expect(applied.length).toBe(1);
    expect(applied[0]!.sourceIds).toEqual(expect.arrayContaining(["f1", "f2"]));
  });
  it("毕业候选:3胜0负", () => {
    const plan = planConsolidation([L({ id: "win", stats: { injected: 3, wins: 3, losses: 0 } })]);
    expect(plan.graduateProposals.some((p) => p.id === "win")).toBe(true);
  });
  it("退役候选:注入多次零胜 或 连败", () => {
    const plan = planConsolidation([
      L({ id: "dead", stats: { injected: 6, wins: 0, losses: 0 } }),
      L({ id: "loser", stats: { injected: 6, wins: 1, losses: 5 } }),
    ]);
    const ids = plan.retireProposals.map((p) => p.id);
    expect(ids).toContain("dead");
    expect(ids).toContain("loser");
  });
});
