import { describe, it, expect } from "vitest";
import { buildSkillsOverview } from "../../src/server/state.js";
import { renderSkills } from "../../src/server/ui/views/skills.js";

const entry = (id: string, origin = "vendored") => ({
  id, name: "技能" + id, description: "描述" + id, origin, tags: ["seo"], enabled: true, category: "growth",
});

const snap = (id: string, playbooks: Array<{ id: string; skills?: string[] }>) => ({
  id, name: "项目" + id, repoPath: "/r/" + id,
  state: { playbooks: playbooks.map((p) => ({ id: p.id, title: p.id, gate: "auto", sections: {}, body: "", ...(p.skills ? { skills: p.skills } : {}) })) },
}) as never;

describe("buildSkillsOverview", () => {
  it("usedBy 汇总跨项目 playbook 引用并按 id 排序", () => {
    const out = buildSkillsOverview(
      [entry("b"), entry("a")],
      [
        snap("p1", [{ id: "pb1", skills: ["a", "b"] }, { id: "pb2", skills: ["a"] }]),
        snap("p2", [{ id: "pb3", skills: ["b"] }, { id: "pb4" }]),
      ],
    );
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out[0]?.usedBy).toEqual([
      { projectId: "p1", playbookId: "pb1" },
      { projectId: "p1", playbookId: "pb2" },
    ]);
    expect(out[1]?.usedBy).toEqual([
      { projectId: "p1", playbookId: "pb1" },
      { projectId: "p2", playbookId: "pb3" },
    ]);
  });

  it("零技能/零项目安全", () => {
    expect(buildSkillsOverview([], [])).toEqual([]);
  });

  it("过滤停用技能并透传治理字段", () => {
    const out = buildSkillsOverview([
      entry("enabled"),
      { ...entry("disabled"), enabled: false, category: "review" },
      { ...entry("legacy"), enabled: undefined, category: undefined },
    ], []);
    expect(out.map((skill) => skill.id)).toEqual(["enabled", "legacy"]);
    expect(out[0]).toMatchObject({ enabled: true, category: "growth" });
    expect(out[1]).not.toHaveProperty("enabled");
    expect(out[1]).not.toHaveProperty("category");
  });
});

describe("renderSkills", () => {
  it("渲染技能卡:名称/id/引用数出现", () => {
    const catalog = buildSkillsOverview([entry("ai-seo", "authored")], [snap("p1", [{ id: "pb1", skills: ["ai-seo"] }])]);
    const html = renderSkills({ skillCatalog: catalog } as never);
    expect(html).toContain("技能ai-seo");
    expect(html).toContain("ai-seo");
    expect(html).toContain("pb1");
    expect(html).toContain("growth");
    expect(html).toContain("1 个技能");
  });

  it("空态给注册提示", () => {
    const html = renderSkills({ skillCatalog: [] } as never);
    expect(html).toContain("kunpeng skill add");
  });
});
