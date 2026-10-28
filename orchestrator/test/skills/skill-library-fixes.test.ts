import { describe, expect, it } from "vitest";
import { parseSkillFrontmatter } from "../../src/skills/skill-md.js";
import { SKILL_CATEGORIES } from "../../src/skills/registry.js";
import { buildSkillsOverview } from "../../src/server/state-overviews.js";

describe("块一 · frontmatter 支持 YAML 块标量", () => {
  it("|- 的多行 description 被收成正文,不是字面量", () => {
    const md = [
      "---",
      "name: acme-skill",
      "description: |-",
      "  第一行说明。",
      "  第二行触发条件。",
      "license: MIT",
      "---",
      "",
      "# 正文",
    ].join("\n");
    const fm = parseSkillFrontmatter(md);
    expect(fm.description).not.toBe("|-");
    expect(fm.description).toContain("第一行说明。");
    expect(fm.description).toContain("第二行触发条件。");
    expect(fm.name).toBe("acme-skill");
  });

  it("单行 description 行为不变", () => {
    const md = ["---", "name: acme-plain", "description: 一行说明", "---", "# 正文"].join("\n");
    expect(parseSkillFrontmatter(md).description).toBe("一行说明");
  });
});

describe("块二 · 分类白名单以 SKILL_CATEGORIES 为唯一真相源", () => {
  it("九个新分类都在册,旧分类保留兼容", () => {
    for (const c of ["strategy", "growth", "docs", "design", "build", "review", "git", "thinking", "agent-internal"]) {
      expect(SKILL_CATEGORIES).toContain(c);
    }
    expect(SKILL_CATEGORIES).toContain("engineering-method");
  });
});

describe("块四 · 技能总览过滤停用并透传分类", () => {
  const entries = [
    { id: "acme-on", name: "启用的", description: "d1", origin: "authored", enabled: true, category: "docs" },
    { id: "acme-off", name: "停用的", description: "d2", origin: "vendored", enabled: false, category: "build" },
    { id: "acme-legacy", name: "老数据无字段", description: "d3", origin: "external" },
  ];

  it("enabled=false 被过滤,undefined 按启用处理", () => {
    const out = buildSkillsOverview(entries, []);
    const ids = out.map((e) => e.id);
    expect(ids).toContain("acme-on");
    expect(ids).toContain("acme-legacy");
    expect(ids).not.toContain("acme-off");
  });

  it("分类被透传到视图条目", () => {
    const out = buildSkillsOverview(entries, []);
    expect(out.find((e) => e.id === "acme-on")?.category).toBe("docs");
  });
});