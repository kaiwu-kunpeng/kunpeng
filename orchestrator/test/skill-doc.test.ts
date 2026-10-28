import matter from "gray-matter";
import { expect, test } from "vitest";
import type { Artifact } from "../src/artifacts/types.js";
import { buildSkillDoc } from "../src/knowledge/skill-doc.js";

test("正常蒸馏 verified 与 rolled-back 经验为 SKILL.md", () => {
  const experiences: Artifact[] = [
    {
      kind: "experience",
      id: "exp-verified",
      status: "draft",
      body: "合并后必对抗审查\n第二行不应进入列表项",
      meta: { outcome: "verified" },
    },
    {
      kind: "experience",
      id: "exp-rolled-back",
      status: "draft",
      body: "子包没 build 脚本\n补充细节",
      meta: {
        outcome: "rolled-back",
        evidence: "npm error Missing script build\nstack trace",
      },
    },
  ];

  const output = buildSkillDoc(experiences, {
    name: "merge-discipline",
    description: "合并后必走真实串线对抗审查",
  });

  const parsed = matter(output);
  expect(parsed.data.name).toBe("merge-discipline");
  expect(parsed.data.description).toContain("对抗审查");
  expect(parsed.content).toContain("## 何时用");
  expect(parsed.content).toContain("## 经验要点");
  expect(parsed.content).toContain("合并后必对抗审查");
  expect(parsed.content).toContain("## 失败蒸馏");
  expect(parsed.content).toContain("子包没 build 脚本");
  expect(parsed.content).toContain("Missing script");
});

test("空数组边界仍产出合法 SKILL.md 与空态文案", () => {
  const output = buildSkillDoc([], {
    name: "empty-skill",
    description: "用于空经验数组",
  });

  const parsed = matter(output);
  expect(parsed.data.name).toBe("empty-skill");
  expect(parsed.content).toContain("## 经验要点");
  expect(parsed.content).toContain("暂无已验证经验");
  expect(parsed.content).toContain("## 失败蒸馏");
  expect(parsed.content).toContain("暂无失败经验");
});

test("frontmatter 特殊字符安全", () => {
  const description = "用于：合并前";

  const output = buildSkillDoc([], {
    name: "safe-frontmatter",
    description,
  });

  expect(matter(output).data.description).toBe(description);
});
