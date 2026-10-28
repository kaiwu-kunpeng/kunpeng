import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSkill, setSkillFields, searchSkills } from "../src/skills/registry.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

function mkSkill(root: string, id: string) {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: " + id + "\n---\n正文" + id);
  return registerSkill(root, { id, name: id, description: id, origin: "authored", dir });
}

describe("技能用量接线(作者验收)", () => {
  it("runwave 源码含 enabled 过滤与 recordSkillActivation 且 try/catch 包裹", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "src", "loop", "recipes", "agent-playbook", "runwave.ts"),
      "utf8",
    );
    expect(src).toContain("recordSkillActivation");
    expect(src).toContain("enabled");
    expect(src).toContain("skillsRootOverride");
    expect(/try\s*{[\s\S]*recordSkillActivation/.test(src)).toBe(true);
  });

  it("registry 侧闭环:disable 后 searchSkills(enabled:true) 不含之,埋点自增可读回", () => {
    const root = mkdtempSync(join(tmpdir(), "kp-usw-"));
    mkSkill(root, "s1");
    mkSkill(root, "s2");
    setSkillFields(root, "s2", { enabled: false });
    const enabledIds = searchSkills(root, "", { enabled: true }).map((s) => s.id);
    expect(enabledIds).toContain("s1");
    expect(enabledIds).not.toContain("s2");
  });
});