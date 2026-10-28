import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSkill, setSkillFields, searchSkills, recordSkillActivation } from "../src/skills/registry.js";
import { guessCategory, categorizeAll } from "../src/skills/auto-categorize.js";

function mkSkill(root: string, id: string, description: string) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: " + id + "\n---\n" + description);
  return registerSkill(root, { id, name: id, description, origin: "authored", dir });
}

describe("技能管理数据层(作者验收)", () => {
  it("setSkillFields/搜索/启停过滤", () => {
    const root = mkdtempSync(join(tmpdir(), "kp-skl-"));
    mkSkill(root, "tdd-basics", "test driven development 方法论");
    mkSkill(root, "geo-watch", "GEO 监控与 AI 可见性");
    setSkillFields(root, "geo-watch", { category: "growth-ops", enabled: false });
    expect(searchSkills(root, "geo").length).toBe(1);
    expect(searchSkills(root, "", { enabled: true }).some((s) => s.id === "geo-watch")).toBe(false);
    expect(searchSkills(root, "", { category: "growth-ops" })[0].id).toBe("geo-watch");
    expect(() => setSkillFields(root, "no-such", { enabled: false })).toThrow();
  });

  it("作用域过滤:未设=全局命中,设了按项目匹配", () => {
    const root = mkdtempSync(join(tmpdir(), "kp-skl2-"));
    mkSkill(root, "a", "任意");
    mkSkill(root, "b", "任意");
    setSkillFields(root, "b", { appliesTo: { projects: ["acme"] } });
    const forKunpeng = searchSkills(root, "", { project: "kunpeng" });
    expect(forKunpeng.some((s) => s.id === "a")).toBe(true);
    expect(forKunpeng.some((s) => s.id === "b")).toBe(false);
    expect(searchSkills(root, "", { project: "acme" }).some((s) => s.id === "b")).toBe(true);
  });

  it("用量埋点自增", () => {
    const root = mkdtempSync(join(tmpdir(), "kp-skl3-"));
    mkSkill(root, "x", "d");
    recordSkillActivation(root, ["x", "ghost"], "2026-07-12T00:00:00Z");
    recordSkillActivation(root, ["x"]);
    const [x] = searchSkills(root, "x");
    expect(x.usage?.activations).toBe(2);
    expect(x.usage?.lastHitAt).toBeTruthy();
  });

  it("guessCategory/categorizeAll", () => {
    expect(guessCategory({ name: "systematic-debugging", description: "debug", dir: "/d" })).toBe("review");
    expect(guessCategory({ name: "pptx", description: "PowerPoint 生成", dir: "/d" })).toBe("docs");
    const root = mkdtempSync(join(tmpdir(), "kp-skl4-"));
    mkSkill(root, "frontend-design", "ui design");
    const { updated } = categorizeAll(root);
    expect(updated).toBe(1);
    expect(searchSkills(root, "", { category: "design" }).length).toBe(1);
  });
});
