import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSkillDirs, importSkills } from "../src/skills/import-external.js";

function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "kp-skimp-"));
  mkdirSync(join(root, "skills", "seo-audit"), { recursive: true });
  writeFileSync(join(root, "skills", "seo-audit", "SKILL.md"), "---\nname: seo-audit\ndescription: SEO 审计技能\n---\n\n# 用法\n");
  mkdirSync(join(root, "skills", "no-name"), { recursive: true });
  writeFileSync(join(root, "skills", "no-name", "SKILL.md"), "---\ndescription: 无名技能\n---\n正文");
  mkdirSync(join(root, "node_modules", "junk"), { recursive: true });
  writeFileSync(join(root, "node_modules", "junk", "SKILL.md"), "---\nname: junk\n---\n");
  return root;
}

describe("外部技能导入(作者验收)", () => {
  it("扫描出 SKILL.md 目录,frontmatter 解析,node_modules 跳过", () => {
    const found = scanSkillDirs(fixtureRepo());
    const names = found.map((c) => c.name).sort();
    expect(names).toContain("seo-audit");
    expect(names).toContain("no-name");
    expect(names).not.toContain("junk");
    const seo = found.find((c) => c.name === "seo-audit");
    expect(seo?.description).toContain("SEO");
  });

  it("导入去重+单个失败不中断", async () => {
    const reg: string[] = [];
    const out = await importSkills(
      [
        { dir: "/a", name: "s1", description: "d1" },
        { dir: "/b", name: "dup", description: "d2" },
        { dir: "/c", name: "boom", description: "d3" },
      ],
      {
        exists: (n) => n === "dup",
        register: (c) => { if (c.name === "boom") throw new Error("x"); reg.push(c.name); },
      },
    );
    expect(out.imported).toEqual(["s1"]);
    expect(out.skipped.sort()).toEqual(["boom", "dup"]);
    expect(reg).toEqual(["s1"]);
  });
});