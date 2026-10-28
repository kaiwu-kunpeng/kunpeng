import { describe, it, expect } from "vitest";
import { renderUsageGuide } from "../../src/server/ui/guide.js";
import { renderSkills } from "../../src/server/ui/views/skills.js";
import { renderLoops } from "../../src/server/ui/views/loops.js";

describe("renderUsageGuide", () => {
  it("渲染 details 折叠块:标题/步骤/命令", () => {
    const html = renderUsageGuide({
      id: "demo",
      title: "演示怎么用",
      intro: "一句话概念",
      steps: [
        { label: "第一步", detail: "细节甲", cmd: "kunpeng demo run" },
        { label: "第二步" },
      ],
    });
    expect(html).toContain("<details");
    expect(html).toContain('data-guide="demo"');
    expect(html).toContain("<summary");
    expect(html).toContain("演示怎么用");
    expect(html).toContain("一句话概念");
    expect(html).toContain("第一步");
    expect(html).toContain("第二步");
    expect(html).toContain("<code>kunpeng demo run</code>");
  });

  it("动态文本转义", () => {
    const html = renderUsageGuide({ id: "x", title: "<b>t</b>", intro: "i", steps: [] });
    expect(html).not.toContain("<b>t</b>");
    expect(html).toContain("&lt;b&gt;t&lt;/b&gt;");
  });
});

describe("两页接入", () => {
  it("技能库页含 skills 引导(空态与非空态都有)", () => {
    const empty = renderSkills({ skillCatalog: [] } as never);
    expect(empty).toContain('data-guide="skills"');
    expect(empty).toContain("kunpeng skill add");
    const filled = renderSkills({
      skillCatalog: [{ id: "a", name: "甲", description: "", origin: "authored", usedBy: [] }],
    } as never);
    expect(filled).toContain('data-guide="skills"');
  });

  it("运营平台页含 ops 引导(loops 空与非空都有)", () => {
    const empty = renderLoops({ loops: [], playbooks: [], opsGates: [], opsReports: [] } as never);
    expect(empty).toContain('data-guide="ops"');
    expect(empty).toContain("kunpeng ops");
    const filled = renderLoops({
      loops: [{
        id: "l1", name: "循环一", projectId: "p1", recipe: "geo-monitor",
        metric: { key: "m", label: "指标", current: 1 },
        levers: [], waves: [], createdAt: 0, updatedAt: 0,
      }],
      playbooks: [], opsGates: [], opsReports: [],
    } as never);
    expect(filled).toContain('data-guide="ops"');
  });
});