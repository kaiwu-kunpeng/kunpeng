import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSkills, listSkills, registerSkill, removeSkill, skillsRoot } from "./registry.js";

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "kp-skills-"));
}

function makeSkillDir(root: string, id: string): string {
  const dir = join(root, "dirs", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: test\n---\nbody`, "utf8");
  return dir;
}

describe("skill registry", () => {
  it("skillsRoot 读 KUNPENG_STATE,缺省落 ~/.kunpeng/skills", () => {
    const custom = skillsRoot({ KUNPENG_STATE: "/tmp/kpstate" } as NodeJS.ProcessEnv);
    expect(custom).toBe(join("/tmp/kpstate", "skills"));
    const def = skillsRoot({} as NodeJS.ProcessEnv);
    expect(def.endsWith(join(".kunpeng", "skills"))).toBe(true);
  });

  it("register/list:落 index.json,upsert 不重复", () => {
    const root = tmpRoot();
    const dir = makeSkillDir(root, "seo-audit");
    const entry = registerSkill(root, {
      id: "seo-audit", name: "SEO 审计", description: "站点 SEO 体检", origin: "vendored",
      tags: ["seo"], dir, license: "MIT", upstream: { url: "https://github.com/x/y" },
    });
    expect(entry.registeredAt).toBeTruthy();
    expect(listSkills(root).length).toBe(1);
    registerSkill(root, {
      id: "seo-audit", name: "SEO 审计 v2", description: "站点 SEO 体检", origin: "vendored", dir,
    });
    const all = listSkills(root);
    expect(all.length).toBe(1);
    expect(all[0].name).toBe("SEO 审计 v2");
  });

  it("register 缺 SKILL.md 抛错", () => {
    const root = tmpRoot();
    expect(() =>
      registerSkill(root, {
        id: "ghost", name: "g", description: "d", origin: "authored",
        dir: join(root, "nonexistent"),
      }),
    ).toThrow();
  });

  it("findSkills 词法打分:命中排序,0 分不返回", () => {
    const root = tmpRoot();
    registerSkill(root, { id: "a", name: "GEO 监测", description: "AI 搜索引用监测", origin: "authored", tags: ["geo"], dir: makeSkillDir(root, "a") });
    registerSkill(root, { id: "b", name: "内容营销", description: "长尾内容生产", origin: "authored", tags: ["content"], dir: makeSkillDir(root, "b") });
    const hits = findSkills(root, "geo 监测");
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe("a");
    expect(findSkills(root, "不存在的词")).toEqual([]);
  });

  it("removeSkill 删除并落盘", () => {
    const root = tmpRoot();
    registerSkill(root, { id: "x", name: "x", description: "d", origin: "authored", dir: makeSkillDir(root, "x") });
    expect(removeSkill(root, "x")).toBe(true);
    expect(removeSkill(root, "x")).toBe(false);
    expect(listSkills(root)).toEqual([]);
  });

  it("空注册表 list 返回空数组", () => {
    expect(listSkills(tmpRoot())).toEqual([]);
  });
});