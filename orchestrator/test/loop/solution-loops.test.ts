import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveTemplateFromProject, instantiateTemplate } from "../../src/loop/solution-template.js";

function makeSourceRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "kp-sol-src-"));
  mkdirSync(join(repo, ".kunpeng", "playbooks"), { recursive: true });
  mkdirSync(join(repo, ".kunpeng", "loops"), { recursive: true });
  writeFileSync(join(repo, ".kunpeng", "playbooks", "pb-a.md"), [
    "---", "id: pb-a", "projectId: src-proj", "loopId: loop-a", "skills: ai-seo", "---", "# 动作A",
  ].join("\n"), "utf8");
  writeFileSync(join(repo, ".kunpeng", "loops", "loop-a.json"), JSON.stringify({
    id: "loop-a", name: "环A", projectId: "src-proj", recipe: "agent-playbook", autonomous: true,
    metric: { key: "m", label: "M", current: 42 },
    levers: [{ id: "pb-a", label: "卡A", status: "active" }],
    nextLever: { lever: "pb-a" }, waves: [{ seq: 1, at: 123 }], createdAt: 1, updatedAt: 1,
  }), "utf8");
  return repo;
}

describe("方案模板携带 loop 定义", () => {
  let root: string;
  let src: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kp-sol-root-"));
    src = makeSourceRepo();
  });

  it("save 抽取 loop:waves 清零/projectId 剥掉/其余保留", () => {
    const t = saveTemplateFromProject(root, src, { id: "t1", name: "T1", playbookIds: ["pb-a"] });
    expect(t.loopFiles).toEqual(["loop-a.json"]);
    const loop = JSON.parse(readFileSync(join(root, "t1", "loops", "loop-a.json"), "utf8"));
    expect(loop.waves).toEqual([]);
    expect(loop.projectId).toBeUndefined();
    expect(loop.autonomous).toBe(true);
    expect(loop.metric.current).toBe(42);
    expect(loop.nextLever.lever).toBe("pb-a");
  });

  it("apply 到空项目:补建 loop,projectId 盖成目标,waves 空", () => {
    saveTemplateFromProject(root, src, { id: "t1", name: "T1", playbookIds: ["pb-a"] });
    const target = mkdtempSync(join(tmpdir(), "kp-sol-tgt-"));
    const r = instantiateTemplate(root, "t1", target, "tgt-proj");
    expect(r.loopsWritten).toEqual(["loop-a.json"]);
    expect(r.loopsSkipped).toEqual([]);
    const loop = JSON.parse(readFileSync(join(target, ".kunpeng", "loops", "loop-a.json"), "utf8"));
    expect(loop.projectId).toBe("tgt-proj");
    expect(loop.waves).toEqual([]);
    expect(loop.autonomous).toBe(true);
  });

  it("目标已有同名 loop → 绝不覆盖,进 loopsSkipped", () => {
    saveTemplateFromProject(root, src, { id: "t1", name: "T1", playbookIds: ["pb-a"] });
    const target = mkdtempSync(join(tmpdir(), "kp-sol-tgt2-"));
    mkdirSync(join(target, ".kunpeng", "loops"), { recursive: true });
    writeFileSync(join(target, ".kunpeng", "loops", "loop-a.json"), JSON.stringify({ id: "loop-a", precious: true }), "utf8");
    const r = instantiateTemplate(root, "t1", target, "tgt-proj");
    expect(r.loopsWritten).toEqual([]);
    expect(r.loopsSkipped).toEqual(["loop-a.json"]);
    expect(JSON.parse(readFileSync(join(target, ".kunpeng", "loops", "loop-a.json"), "utf8")).precious).toBe(true);
  });

  it("playbook 无 loopId 或 loop 文件缺失 → 模板照存,loopFiles 不含它", () => {
    writeFileSync(join(src, ".kunpeng", "playbooks", "pb-b.md"), ["---", "id: pb-b", "loopId: ghost", "---", "# B"].join("\n"), "utf8");
    const t = saveTemplateFromProject(root, src, { id: "t2", name: "T2", playbookIds: ["pb-b"] });
    expect(t.loopFiles ?? []).toEqual([]);
    expect(existsSync(join(root, "t2", "playbooks", "pb-b.md"))).toBe(true);
  });
});