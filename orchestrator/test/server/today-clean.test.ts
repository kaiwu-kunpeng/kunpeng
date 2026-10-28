import { describe, it, expect } from "vitest";
import { todaySummary } from "../../src/server/today.js";
import { stripInlineMd } from "../../src/server/ui/fmt.js";

const NOW = 1_800_000_000_000;

describe("todaySummary 桶内同题合并", () => {
  it("blocked 桶同题只留最新一条并带 dupCount", () => {
    const tasks = [
      { id: "f1", title: "# sync/rebuild 失败告警", status: "blocked", updatedAt: NOW - 3000 },
      { id: "f2", title: "# sync/rebuild 失败告警", status: "blocked", updatedAt: NOW - 1000 },
      { id: "f3", title: "# sync/rebuild 失败告警", status: "blocked", updatedAt: NOW - 2000 },
      { id: "f4", title: "另一个卡点", status: "blocked", updatedAt: NOW - 500 },
    ];
    const s = todaySummary({ tasks, now: NOW, windowMs: 24 * 3600_000 });
    expect(s.blocked).toHaveLength(2);
    const merged = s.blocked.find((t) => t.id === "f2");
    expect(merged).toBeTruthy();
    expect(merged?.dupCount).toBe(3);
    expect(s.blocked.find((t) => t.id === "f4")?.dupCount).toBeUndefined();
    expect(s.counts.blocked).toBe(2);
  });
  it("不同题不合并，running/needsReview 同样生效", () => {
    const tasks = [
      { id: "a", title: "任务甲", status: "running", updatedAt: NOW },
      { id: "b", title: "任务乙", status: "running", updatedAt: NOW },
      { id: "c", title: "任务甲", status: "needs-review", updatedAt: NOW },
    ];
    const s = todaySummary({ tasks, now: NOW });
    expect(s.running).toHaveLength(2);
    expect(s.needsReview).toHaveLength(1);
  });
  it("无 title 用 id 归并键，互不误合", () => {
    const tasks = [
      { id: "x1", status: "blocked", updatedAt: NOW },
      { id: "x2", status: "blocked", updatedAt: NOW - 1 },
    ];
    const s = todaySummary({ tasks, now: NOW, windowMs: 24 * 3600_000 });
    expect(s.blocked).toHaveLength(2);
  });
});

describe("stripInlineMd 保留换行", () => {
  it("剥记号但保留分段", () => {
    const src = "## 标题\n\n正文 **重点** 与 `代码`\n- 列表项";
    const out = stripInlineMd(src);
    expect(out).toContain("\n");
    expect(out).not.toContain("##");
    expect(out).not.toContain("**");
    expect(out).not.toContain("`");
    expect(out).toContain("重点");
    expect(out).toContain("列表项");
  });
});