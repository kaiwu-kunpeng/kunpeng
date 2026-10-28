import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveTemplateFromProject, instantiateTemplate, substituteProjectVars } from "../../src/loop/solution-template.js";

function makeSourceRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "kp-solcfg-src-"));
  mkdirSync(join(repo, ".kunpeng", "playbooks"), { recursive: true });
  mkdirSync(join(repo, ".kunpeng", "geo"), { recursive: true });
  writeFileSync(join(repo, ".kunpeng", "playbooks", "pb-geo.md"), [
    "---", "id: pb-geo", "projectId: src-proj", "---", "# 审计 {{project.name}} 站点 ({{project.id}})",
  ].join("\n"), "utf8");
  writeFileSync(join(repo, ".kunpeng", "geo", "config.json"), JSON.stringify({
    brandNames: ["{{project.name}}"],
    questions: ["Q1"],
  }), "utf8");
  return repo;
}

describe("方案模板携带配置文件+项目变量替换", () => {
  let root: string;
  let src: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kp-solcfg-root-"));
    src = makeSourceRepo();
  });

  it("substituteProjectVars 全量替换 {{project.id}} 与 {{project.name}}", () => {
    const out = substituteProjectVars("a={{project.id}} b={{project.name}} c={{project.name}}", {
      projectId: "p1",
      projectName: "壹号",
    });
    expect(out).toBe("a=p1 b=壹号 c=壹号");
    expect(substituteProjectVars("n={{project.name}}", { projectId: "p2" })).toBe("n=p2");
  });

  it("save 把 configPaths 抄进模板并登记 configFiles;缺文件或越界路径报错", () => {
    const template = saveTemplateFromProject(root, src, {
      id: "t1",
      name: "模板一",
      playbookIds: ["pb-geo"],
      configPaths: [".kunpeng/geo/config.json"],
    });
    expect(template.configFiles).toEqual([".kunpeng/geo/config.json"]);
    expect(existsSync(join(root, "t1", "config", ".kunpeng", "geo", "config.json"))).toBe(true);
    expect(() =>
      saveTemplateFromProject(root, src, {
        id: "t2",
        name: "模板二",
        playbookIds: ["pb-geo"],
        configPaths: [".kunpeng/不存在.json"],
      }),
    ).toThrow();
    expect(() =>
      saveTemplateFromProject(root, src, {
        id: "t3",
        name: "模板三",
        playbookIds: ["pb-geo"],
        configPaths: ["../越界.json"],
      }),
    ).toThrow();
  });

  it("apply 落配置且变量替换生效;playbook 正文同样替换;再 apply 跳过不覆盖", () => {
    saveTemplateFromProject(root, src, {
      id: "t1",
      name: "模板一",
      playbookIds: ["pb-geo"],
      configPaths: [".kunpeng/geo/config.json"],
    });
    const target = mkdtempSync(join(tmpdir(), "kp-solcfg-dst-"));
    const first = instantiateTemplate(root, "t1", target, "proj-x", { projectName: "叉项目" });
    expect(first.configsWritten).toEqual([".kunpeng/geo/config.json"]);
    expect(first.configsSkipped).toEqual([]);
    const cfg = JSON.parse(readFileSync(join(target, ".kunpeng", "geo", "config.json"), "utf8")) as {
      brandNames: string[];
    };
    expect(cfg.brandNames).toEqual(["叉项目"]);
    const playbook = readFileSync(join(target, ".kunpeng", "playbooks", "pb-geo.md"), "utf8");
    expect(playbook).toContain("审计 叉项目 站点 (proj-x)");
    expect(playbook).not.toContain("{{project.name}}");
    expect(playbook).not.toContain("{{project.id}}");

    const second = instantiateTemplate(root, "t1", target, "proj-x", { projectName: "叉项目" });
    expect(second.configsWritten).toEqual([]);
    expect(second.configsSkipped).toEqual([".kunpeng/geo/config.json"]);
  });

  it("不带 opts 时 projectName 缺省为 projectId(向后兼容旧签名)", () => {
    saveTemplateFromProject(root, src, {
      id: "t4",
      name: "模板四",
      playbookIds: ["pb-geo"],
      configPaths: [".kunpeng/geo/config.json"],
    });
    const target = mkdtempSync(join(tmpdir(), "kp-solcfg-dst4-"));
    const result = instantiateTemplate(root, "t4", target, "proj-y");
    expect(result.configsWritten).toEqual([".kunpeng/geo/config.json"]);
    const playbook = readFileSync(join(target, ".kunpeng", "playbooks", "pb-geo.md"), "utf8");
    expect(playbook).toContain("审计 proj-y 站点 (proj-y)");
  });
});