import { describe, it, expect } from "vitest";
import { renderProjectOps } from "../../src/server/ui/views/project.js";

const DAY = 86_400_000;

function playbook(over: Record<string, unknown>) {
  return { id: "pb", title: "动作", gate: "review", sections: {}, body: "", ...over };
}

describe("项目详情页·运营 tab", () => {
  it("空态给出 solution apply 指引", () => {
    const html = renderProjectOps({ playbooks: [], loops: [] });
    expect(html).toContain("运营方案");
    expect(html).toContain("还没有运营 playbook");
    expect(html).toContain("solution apply");
  });

  it("卡片渲染标题/阶段/门/技能组合", () => {
    const html = renderProjectOps({
      playbooks: [playbook({ id: "tl-geo-audit", title: "GEO审计", phase: "research", cadence: "weekly", gate: "auto", skills: ["ai-seo", "seo-audit"], loopId: "tl-geo-audit" }) as never],
      loops: [],
    }, { now: 1000 });
    expect(html).toContain("GEO审计");
    expect(html).toContain("research");
    expect(html).toContain("自动");
    expect(html).toContain("<code>ai-seo</code>");
    expect(html).toContain("<code>seo-audit</code>");
  });

  it("到期判定:无记录→到期;近期跑过→未到期;无loopId→未接loop", () => {
    const now = 10 * DAY;
    const loops = [{ id: "l-fresh", waves: [{ at: now - DAY }] }, { id: "l-stale", waves: [{ at: now - 8 * DAY }] }] as never;
    const html = renderProjectOps({
      playbooks: [
        playbook({ id: "a", title: "无记录", cadence: "weekly", loopId: "l-none" }) as never,
        playbook({ id: "b", title: "新鲜", cadence: "weekly", loopId: "l-fresh" }) as never,
        playbook({ id: "c", title: "过期", cadence: "weekly", loopId: "l-stale" }) as never,
        playbook({ id: "d", title: "没接" }) as never,
      ],
      loops,
    }, { now });
    const seg = (title: string) => html.slice(html.indexOf(title), html.indexOf(title) + 600);
    expect(seg("无记录")).toContain("到期待跑");
    expect(seg("新鲜")).toContain("未到期");
    expect(seg("过期")).toContain("到期待跑");
    expect(seg("没接")).toContain("未接 loop");
  });

  it("XSS:标题与技能名被转义", () => {
    const html = renderProjectOps({
      playbooks: [playbook({ id: "x", title: "<script>alert(1)</script>", skills: ["<img src=x>"] }) as never],
      loops: [],
    }, { now: 0 });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x>");
  });
});