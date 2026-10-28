import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills, recordSkillActivation } from "../../src/skills/registry.js";

describe("审计修复E skills 坏档兜底", () => {
  it("坏 index.json 不 crash 读侧", () => {
    const root = mkdtempSync(join(tmpdir(), "kp-skills-e-"));
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "index.json"), "{ this is not json");
      expect(listSkills(root)).toEqual([]);
      expect(() => recordSkillActivation(root, ["x"])).not.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("合法 index 仍正常读出", () => {
    const root = mkdtempSync(join(tmpdir(), "kp-skills-e2-"));
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "index.json"), JSON.stringify([{ id: "s1", name: "s1", description: "d", dir: "/x", registeredAt: "t" }]));
      expect(listSkills(root).map((s) => s.id)).toEqual(["s1"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});