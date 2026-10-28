import { describe, it, expect } from "vitest";
import { parseSkillFrontmatter, skillEntryFromDir } from "../../src/skills/skill-md.js";

const MD = `---
name: AI SEO 技能
description: 给页面补 AI 直答段并更新 llms.txt
tags: [seo, geo]
layer: domain
---
# AI SEO 技能
## 何时用
给页面补 AI 直答段
`;

describe("parseSkillFrontmatter", () => {
  it("解析 name/description/tags(行内数组)/layer", () => {
    const fm = parseSkillFrontmatter(MD);
    expect(fm.name).toBe("AI SEO 技能");
    expect(fm.description).toBe("给页面补 AI 直答段并更新 llms.txt");
    expect(fm.tags).toEqual(["seo", "geo"]);
    expect(fm.layer).toBe("domain");
  });

  it("tags 逗号写法也支持", () => {
    const fm = parseSkillFrontmatter("---\nname: X\ntags: a, b, c\n---\n# X");
    expect(fm.tags).toEqual(["a", "b", "c"]);
  });

  it("解析 literal 与 folded 块标量并在同级字段处停止", () => {
    const literal = parseSkillFrontmatter("---\nname: X\ndescription: |-\n  第一行\n  第二行\ntags: [a]\n---\n# X");
    expect(literal.description).toBe("第一行\n第二行");
    expect(literal.tags).toEqual(["a"]);

    const folded = parseSkillFrontmatter("---\nname: X\ndescription: >-\n  第一行\n  第二行\nlayer: domain\n---\n# X");
    expect(folded.description).toBe("第一行 第二行");
    expect(folded.layer).toBe("domain");
  });

  it("无 frontmatter → {}", () => {
    expect(parseSkillFrontmatter("# 没有 frontmatter\n正文")).toEqual({});
    expect(parseSkillFrontmatter("")).toEqual({});
  });
});

describe("skillEntryFromDir", () => {
  it("frontmatter 齐全 → 完整 entry", () => {
    const e = skillEntryFromDir("/skills/ai-seo", MD, "authored", "ai-seo");
    expect(e).toEqual({
      id: "ai-seo",
      name: "AI SEO 技能",
      description: "给页面补 AI 直答段并更新 llms.txt",
      origin: "authored",
      tags: ["seo", "geo"],
      layer: "domain",
      dir: "/skills/ai-seo",
    });
  });

  it("无 frontmatter → id 兜底 name、description 空、无 tags/layer", () => {
    const e = skillEntryFromDir("/skills/foo", "# 正文无 fm", "distilled", "foo");
    expect(e.id).toBe("foo");
    expect(e.name).toBe("foo");
    expect(e.description).toBe("");
    expect(e.origin).toBe("distilled");
    expect(e.dir).toBe("/skills/foo");
    expect(e.tags).toBeUndefined();
    expect(e.layer).toBeUndefined();
  });

  it("非法 layer 不带上", () => {
    const e = skillEntryFromDir("/skills/x", "---\nname: X\nlayer: bogus\n---\n#X", "vendored", "x");
    expect(e.layer).toBeUndefined();
  });
});
