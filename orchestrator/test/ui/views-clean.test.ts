import { describe, it, expect } from "vitest";
import { stripMd } from "../../src/server/ui/fmt.js";
import { cleanKnowledgeText, cleanKnowledgeTime } from "../../src/server/ui/views/knowledge.js";
import { renderEvolution } from "../../src/server/ui/views/evolution.js";
import type { DashboardState } from "../../src/server/state.js";

function stateWith(over: Record<string, unknown>): DashboardState {
  return { humanGates: [], flows: [], artifacts: {}, ...over } as unknown as DashboardState;
}

describe("stripMd 图片语法", () => {
  it("图片 markdown 留 alt 文本", () => {
    expect(stripMd("![今日头条](https://x.com/logo.png) 正文")).toBe("今日头条 正文");
  });
  it("alt 为空整段剥除", () => {
    expect(stripMd("![](https://x.com/a.png)开头")).toBe("开头");
  });
  it("多个图片与链接混排", () => {
    const out = stripMd("![a](http://x/1.png)![b](http://x/2.png) [文](http://y) 后");
    expect(out).not.toContain("http");
    expect(out).toContain("文 后");
  });
});

describe("视图接线(行为断言)", () => {
  it("knowledge 清洗层真接线:markdown 剥净 + 相对时间", () => {
    expect(cleanKnowledgeText("**加粗** ![图标](https://x.com/logo.png) 正文")).toBe("加粗 图标 正文");
    expect(cleanKnowledgeTime({ createdAt: Date.now() - 120_000 })).toBe("2 分钟前");
  });

  it("evolution 渲染剥 markdown:lastRunText 无 ** 无图片 URL,文字保留", () => {
    const html = renderEvolution(stateWith({
      evolution: { pendingCount: 1, approvedCount: 0, lastRunText: "**巡检** ![徽](https://x.com/b.png) 完成", proposals: [] },
    }));
    expect(html).toContain("巡检");
    expect(html.includes("**")).toBe(false);
    expect(html.includes("https://x.com")).toBe(false);
  });

  it("evolution 渲染 pending 提案带相对时间(relTime 真接线)", () => {
    const html = renderEvolution(stateWith({
      evolution: { pendingCount: 1, approvedCount: 0, lastRunText: "x", proposals: [{ id: "p1", title: "t", status: "pending", updatedAt: Date.now() - 120_000 }] },
    }));
    expect(html).toContain("分钟前");
  });
});