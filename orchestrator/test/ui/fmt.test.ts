import { describe, it, expect } from "vitest";
import { stripMd, clip, relTime, fmtTokens } from "../../src/server/ui/fmt.js";
import { buildTaskBoard } from "../../src/cockpit/task-board.js";

const NOW = 1_800_000_000_000;

describe("stripMd", () => {
  it("剥标题/粗体/行内代码/链接/列表记号", () => {
    expect(stripMd("## 修复 **登录** 的 `bug`")).toBe("修复 登录 的 bug");
    expect(stripMd("- [文档](http://x) 更新")).toBe("文档 更新");
    expect(stripMd("1. 第一项")).toBe("第一项");
  });
  it("多行折叠成单行", () => {
    expect(stripMd("# 标题\n\n正文 **重点**")).toBe("标题 正文 重点");
  });
  it("普通文本原样", () => {
    expect(stripMd("普通标题没有记号")).toBe("普通标题没有记号");
  });
});

describe("clip", () => {
  it("超长截断带省略号", () => {
    expect(clip("一二三四五六", 4)).toBe("一二三…");
    expect(clip("短", 10)).toBe("短");
  });
});

describe("relTime", () => {
  it("刚刚/分钟/小时/天/日期", () => {
    expect(relTime(NOW - 30_000, NOW)).toBe("刚刚");
    expect(relTime(NOW - 5 * 60_000, NOW)).toBe("5 分钟前");
    expect(relTime(NOW - 3 * 3600_000, NOW)).toBe("3 小时前");
    expect(relTime(NOW - 2 * 24 * 3600_000, NOW)).toBe("2 天前");
    expect(relTime(NOW - 30 * 24 * 3600_000, NOW)).toMatch(/^\d{1,2}-\d{1,2}$/);
  });
  it("非法与未来值给空串", () => {
    expect(relTime(Number.NaN, NOW)).toBe("");
    expect(relTime(NOW + 60_000, NOW)).toBe("");
  });
});

describe("fmtTokens", () => {
  it("千与百万缩写", () => {
    expect(fmtTokens(999)).toBe("999");
    expect(fmtTokens(24_700)).toBe("24.7k");
    expect(fmtTokens(24_000)).toBe("24k");
    expect(fmtTokens(3_200_000)).toBe("3.2M");
    expect(fmtTokens(Number.NaN)).toBe("0");
  });
});

describe("任务台行接清洗层", () => {
  it("markdown 记号不再泄漏进行标题", () => {
    const board = buildTaskBoard([
      {
        flowId: "f1",
        requirement: "## 给 **知识库** 加 `搜索`",
        stage: "implement",
        status: "running",
        updatedAt: NOW,
      } as never,
    ]);
    const req = board.rows[0]?.requirement ?? "";
    expect(req).not.toContain("##");
    expect(req).not.toContain("**");
    expect(req).not.toContain("`");
    expect(req).toContain("知识库");
  });
});
describe("stripMd 容错（2026-07-02 /api/today 500 回归）", () => {
  it("undefined/null 输入返回空串不抛", () => {
    expect(stripMd(undefined as unknown as string)).toBe("");
    expect(stripMd(null as unknown as string)).toBe("");
  });
});
