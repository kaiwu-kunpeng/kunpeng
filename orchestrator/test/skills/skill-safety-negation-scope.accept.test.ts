import { describe, expect, test } from "vitest";
import { scanSkillSafety } from "../../src/skills/skill-safety.js";

const j = (...parts: string[]): string => parts.join("");

describe("否定词豁免只在同一分句且紧邻命中时生效（作者锁定）", () => {
  test.each([
    ["skip-git-hooks", j("If hooks are not installed, commit with git commit --no", "-verify")],
    ["skip-git-hooks", j("没有时间就用 git commit --no", "-verify 提交")],
    ["dangerous-permission-flag", j("No need to ask: claude --dangerously-skip", "-permissions")],
    ["force-push", j("Not optional: git push --for", "ce origin main")],
    ["skip-git-hooks", j("If the linter is not happy just run git commit --no", "-verify")],
    ["force-push", j("别担心冲突，直接 git push --for", "ce")],
  ])("%s 仍被硬拦：%s", (reason, text) => {
    const verdict = scanSkillSafety(`# 技能\n\n${text}\n`);
    expect(verdict.safe).toBe(false);
    expect(verdict.block).toContain(reason);
  });

  test.each([
    j("绝不用 --no", "-verify"),
    j("不要 git push --for", "ce"),
    "禁止绕过人工门",
    "Never skip the review gate",
    "测试失败不是删掉测试的理由",
    j("do not run git commit --no", "-verify"),
    j("Do not use git push --for", "ce on main"),
  ])("禁令语境仍豁免：%s", (text) => {
    expect(scanSkillSafety(text)).toEqual({ safe: true, block: [], warn: [] });
  });
});