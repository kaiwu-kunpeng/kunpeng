import matter from "gray-matter";
import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { distillSkillToFile } from "../src/knowledge/distill-skill.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-distill-skill-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("distillSkillToFile writes a draft skill from real experience artifacts", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  await store.write({
    kind: "experience",
    id: "exp-verified",
    status: "verified",
    body: "合并后必对抗审查\n第二行不应进入列表项",
    meta: { source: "review", outcome: "verified" },
  });
  await store.write({
    kind: "experience",
    id: "exp-rolled-back",
    status: "rolled-back",
    body: "空壳测试不能证明实现正确\n补充细节",
    meta: {
      source: "mutation",
      outcome: "rolled-back",
      evidence: "故意改坏源码后测试仍绿",
    },
  });

  const result = await distillSkillToFile({
    store,
    outDir: join(dir, ".kunpeng", "skills"),
    name: "Merge Discipline",
    description: "合并后必对抗审查",
  });

  expect(result.experienceCount).toBe(2);
  expect(result.path).toMatch(/merge-discipline\/SKILL\.md$/);

  const parsed = matter(readFileSync(result.path, "utf8"));
  expect(parsed.data.name).toBe("Merge Discipline");
  expect(parsed.data.description).toBe("合并后必对抗审查");
  expect(parsed.content).toContain("经验要点");
  expect(parsed.content).toContain("失败蒸馏");
});

test("distillSkillToFile rejects empty experience stores and writes nothing", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  const skillPath = join(dir, ".kunpeng", "skills", "merge-discipline", "SKILL.md");

  await expect(distillSkillToFile({
    store,
    outDir: join(dir, ".kunpeng", "skills"),
    name: "Merge Discipline",
    description: "合并后必对抗审查",
  })).rejects.toThrow("无经验可蒸馏（experience 为空）");

  expect(existsSync(skillPath)).toBe(false);
});
