import { describe, it, expect } from "vitest";
import { renderActionInbox } from "../../src/server/ui/views/action-inbox.js";

const base = { humanGates: [], failures: [], blockers: [], runningCount: 0, projectFlows: [] };

describe("renderActionInbox", () => {
  it("领头标题=待我处理 + 裁决句", () => {
    const html = renderActionInbox({ ...base, runningCount: 3 });
    expect(html).toContain("待我处理");
    expect(html).toContain("一切自动运行中");
  });

  it("空队列渲染安心卡", () => {
    expect(renderActionInbox(base)).toContain("没有待你处理的事");
  });

  it("合并门:既有动作按钮 + AI 预审 + data-project", () => {
    const html = renderActionInbox({
      ...base,
      humanGates: [{ what: "合并 X", detail: "改了 a.ts", flowId: "g1", project: "kunpeng", preReview: { verdict: "approve", reason: "纯加性" } }],
    });
    expect(html).toContain('data-action="merge-main"');
    expect(html).toContain('data-action="reject"');
    expect(html).toContain('data-project="kunpeng"');
    expect(html).toContain("建议批准");
  });

  it("失败卡:重跑 + 看改动(真动作),不再用 view", () => {
    const html = renderActionInbox({
      ...base,
      failures: [{ flowId: "f1", requirement: "做 Y", reason: "测试红", project: "acme-shop" }],
    });
    expect(html).toContain('data-action="rerun-flow"');
    expect(html).toContain('data-action="gate-diff"');
    expect(html).toContain('data-project="acme-shop"');
    expect(html).toContain("重跑");
    expect(html).not.toContain('data-action="view"');
  });

  it("卡住卡:续跑 + 中止", () => {
    const html = renderActionInbox({
      ...base,
      blockers: [{ flowId: "b1", stage: "verify", reason: "缺 fixture", project: "kunpeng" }],
    });
    expect(html).toContain('data-action="resume-flow"');
    expect(html).toContain('data-action="abandon-flow"');
    expect(html).toContain("续跑");
    expect(html).toContain("中止");
  });

  it("项目汇总灯按最坏态着色", () => {
    const html = renderActionInbox({ ...base, projectFlows: [{ project: "alpha", status: "rolled-back" }] });
    expect(html).toContain("proj-lights");
    expect(html).toContain("tag-danger");
  });

  it("转义 HTML 防 XSS", () => {
    const html = renderActionInbox({ ...base, failures: [{ flowId: "<img src=x onerror=alert(1)>", reason: "r" }] });
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;img");
  });
});