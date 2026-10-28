import { describe, expect, it } from "vitest";
import { parseSkillFrontmatter, validateSkillMd, matchesTriggers } from "../src/skills/skill-md.js";

const good = "---\nname: doubt-driven-development\ndescription: 对每个非平凡决策做对抗审查\ntriggers: [重构, 高风险, 不可逆]\n---\n\n# 对抗审查驱动开发\n\n正文\n";

describe("SKILL.md 标准兼容(作者验收)", () => {
  it("解析 frontmatter 含 triggers 行内数组", () => {
    const fm = parseSkillFrontmatter(good);
    expect(fm?.name).toBe("doubt-driven-development");
    expect(fm?.triggers).toEqual(["重构", "高风险", "不可逆"]);
    expect(parseSkillFrontmatter("无前言正文")).toBeNull();
  });
  it("校验:合法通过,非 kebab-case name 报错,缺 description 报错", () => {
    const valid = validateSkillMd(good);
    expect(valid.ok).toBe(true);
    expect(valid.errors).toEqual([]);
    expect(valid.warnings).toEqual([]);
    const badName = good.replace("doubt-driven-development", "Doubt_Driven");
    const r1 = validateSkillMd(badName);
    expect(r1.ok).toBe(false);
    expect(r1.errors.some((e) => e.includes("name") || e.includes("kebab"))).toBe(true);
    const noDesc = good.replace("description: 对每个非平凡决策做对抗审查\n", "");
    expect(validateSkillMd(noDesc).ok).toBe(false);
  });
  it("缺少正文一级标题只警告,不影响合格状态", () => {
    const noH1 = good.replace("# 对抗审查驱动开发", "对抗审查驱动开发");
    const result = validateSkillMd(noH1);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("一级标题"))).toBe(true);
  });
  it("触发词匹配:命中/未命中/无 triggers 总匹配", () => {
    const fm = parseSkillFrontmatter(good)!;
    expect(matchesTriggers(fm, "这是一次高风险重构")).toBe(true);
    expect(matchesTriggers(fm, "写一首诗")).toBe(false);
    expect(matchesTriggers({ name: "n", description: "d" }, "任何文本")).toBe(true);
  });
});
