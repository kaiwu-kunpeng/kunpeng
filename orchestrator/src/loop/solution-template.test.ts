import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  instantiateTemplate, listTemplates, saveTemplateFromProject, solutionsRoot,
} from "./solution-template.js";

function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writePlaybook(repoRoot: string, id: string, projectId: string): void {
  const dir = join(repoRoot, ".kunpeng", "playbooks");
  mkdirSync(dir, { recursive: true });
  const md = [
    "---",
    `id: ${id}`,
    `title: 卡片 ${id}`,
    `projectId: ${projectId}`,
    "cadence: weekly",
    "gate: review",
    "---",
    `# 卡片 ${id}`,
    "## 检查节奏",
    "每周",
  ].join("\n");
  writeFileSync(join(dir, `${id}.md`), md, "utf8");
}

describe("solution template", () => {
  it("solutionsRoot 读 KUNPENG_STATE", () => {
    expect(solutionsRoot({ KUNPENG_STATE: "/tmp/kps" } as NodeJS.ProcessEnv)).toBe(join("/tmp/kps", "solutions"));
  });

  it("save:抽取指定 playbook,剥 projectId,落模板目录", () => {
    const root = tmpDir("kp-sol-");
    const repo = tmpDir("kp-repo-");
    writePlaybook(repo, "s1-demand", "projA");
    writePlaybook(repo, "geo-watch", "projA");
    const tpl = saveTemplateFromProject(root, repo, {
      id: "seo-starter", name: "SEO 起步方案", playbookIds: ["s1-demand", "geo-watch"],
    });
    expect(tpl.playbookFiles.length).toBe(2);
    const copied = readFileSync(join(root, "seo-starter", "playbooks", "s1-demand.md"), "utf8");
    expect(copied).not.toContain("projectId:");
    expect(copied).toContain("id: s1-demand");
    expect(listTemplates(root).length).toBe(1);
    expect(listTemplates(root)[0].id).toBe("seo-starter");
  });

  it("save 找不到 playbookId 抛中文错误", () => {
    const root = tmpDir("kp-sol-");
    const repo = tmpDir("kp-repo-");
    writePlaybook(repo, "a", "p");
    expect(() =>
      saveTemplateFromProject(root, repo, { id: "t", name: "T", playbookIds: ["不存在的卡"] }),
    ).toThrow();
  });

  it("apply:拷入目标项目并写 projectId;同名不覆盖记 skipped", () => {
    const root = tmpDir("kp-sol-");
    const src = tmpDir("kp-src-");
    const dst = tmpDir("kp-dst-");
    writePlaybook(src, "s1-demand", "projA");
    saveTemplateFromProject(root, src, { id: "starter", name: "起步", playbookIds: ["s1-demand"] });
    const r1 = instantiateTemplate(root, "starter", dst, "projB");
    expect(r1.written.length).toBe(1);
    expect(r1.skipped.length).toBe(0);
    const written = readFileSync(join(dst, ".kunpeng", "playbooks", "s1-demand.md"), "utf8");
    expect(written).toContain("projectId: projB");
    expect(existsSync(join(dst, ".kunpeng", "playbooks", "s1-demand.md"))).toBe(true);
    const r2 = instantiateTemplate(root, "starter", dst, "projB");
    expect(r2.written.length).toBe(0);
    expect(r2.skipped.length).toBe(1);
  });

  it("模板不存在 apply 抛错;空 root list 返回空", () => {
    const root = tmpDir("kp-sol-");
    expect(listTemplates(root)).toEqual([]);
    expect(() => instantiateTemplate(root, "ghost", tmpDir("kp-x-"), "p")).toThrow();
  });
});