import { describe, it, expect } from "vitest";
import { buildMemoryContext } from "../../src/knowledge/memory-context.js";

const caps = [
  { tags: ["pty", "pool"], summary: "PtySessionPool 上限+回收的做法" },
  { tags: ["git"], summary: "worktree 隔离避免 clobber" },
  { tags: ["irrelevant"], summary: "完全无关的条目" },
];

describe("buildMemoryContext", () => {
  it("选相关经验、带标题", () => {
    const ctx = buildMemoryContext(caps, "给 PtySessionPool 加上限", { minScore: 1, k: 3 });
    expect(ctx).toContain("## 相关经验（方法论资产）");
    expect(ctx).toContain("PtySessionPool 上限");
    expect(ctx).not.toContain("完全无关");
  });
  it("无相关 → 空串", () => {
    expect(buildMemoryContext(caps, "zzz 毫不相关 nothing", { minScore: 1 })).toBe("");
  });
  it("空 captures → 空串", () => {
    expect(buildMemoryContext([], "PtySessionPool")).toBe("");
  });
  it("超长 summary 截断到 200 + …", () => {
    const long = [{ tags: ["foo_bar"], summary: "x".repeat(500) }];
    const ctx = buildMemoryContext(long, "改 foo_bar", { minScore: 1 });
    expect(ctx).toContain("…");
    expect(ctx.length).toBeLessThan(300);
  });
});
