import { describe, expect, it } from "vitest";
import { validateSkillMd, matchesTriggers, parseSkillFrontmatter } from "../src/skills/skill-md.js";

describe("triggers 渐进披露 + h1 放宽(作者验收)", () => {
  it("缺 h1 不再是 error(降为 warning),仍合格", () => {
    const noH1 = "---\nname: code-review\ndescription: 审查代码\n---\n\n正文没有一级标题\n";
    const r = validateSkillMd(noH1);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("一级标题"))).toBe(true);
  });
  it("真错误仍是 error 判不合格", () => {
    const badName = "---\nname: Code Review\ndescription: x\n---\n\n# 标题\n";
    expect(validateSkillMd(badName).ok).toBe(false);
  });
  it("triggers 匹配 goal 语义(渐进披露排序依据)", () => {
    const fm = parseSkillFrontmatter("---\nname: cro\ndescription: d\ntriggers: [转化, 落地页]\n---\n\n# t\n")!;
    expect(matchesTriggers(fm, "优化落地页转化率")).toBe(true);
    expect(matchesTriggers(fm, "写一份财报")).toBe(false);
  });
});