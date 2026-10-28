import { describe, it, expect } from "vitest";
import { parsePlaybook, parseSkillsList } from "../../src/loop/playbook.js";

describe("playbook 声明技能序列", () => {
  it("frontmatter skills 逗号分隔解析为数组", () => {
    const md = ["---", "id: pb-x", "skills: geo-audit, content-brief", "---", "# 动作X"].join("\n");
    const p = parsePlaybook(md);
    expect(p?.skills).toEqual(["geo-audit", "content-brief"]);
  });

  it("无 skills 字段 → undefined", () => {
    const md = ["---", "id: pb-y", "---", "# 动作Y"].join("\n");
    expect(parsePlaybook(md)?.skills).toBeUndefined();
  });

  it("parseSkillsList 清洗空项/顿号/空串", () => {
    expect(parseSkillsList("a,, b 、c ,")).toEqual(["a", "b", "c"]);
    expect(parseSkillsList("   ")).toBeUndefined();
    expect(parseSkillsList(undefined)).toBeUndefined();
  });
});