import { expect, test } from "vitest";
import type { Finding } from "../../src/loop/guardian.js";
import { findingToTask, findingsToTasks, GUARDIAN_REINJECT_PREFIX, isGuardianReinjectRequirement } from "../../src/feedback/finding-to-task.js";

test("守护 reinject 前缀已导出且 findingToTask 的 requirement 以它开头", () => {
  expect(GUARDIAN_REINJECT_PREFIX.length).toBeGreaterThan(0);
  const task = findingToTask({ scanner: "lint", severity: "warn", file: "src/x.ts", line: 5, message: "no-empty" });
  expect(task.requirement.startsWith(GUARDIAN_REINJECT_PREFIX)).toBe(true);
});

test("isGuardianReinjectRequirement 认守护来源、拒普通需求", () => {
  const task = findingToTask({ scanner: "lint", severity: "error", file: "src/x.ts", line: 5, message: "no-empty" });
  expect(isGuardianReinjectRequirement(task.requirement)).toBe(true);
  expect(isGuardianReinjectRequirement("给 PtySessionPool 加会话上限")).toBe(false);
  expect(isGuardianReinjectRequirement("")).toBe(false);
});

test("缺省丢弃 warn 级 lint（守护 lint 恒为 warn → 不再自动建流）", () => {
  const lintWarn: Finding = { scanner: "lint", severity: "warn", file: "src/x.ts", line: 5, message: "unexpected any" };
  expect(findingsToTasks([lintWarn])).toHaveLength(0);
  expect(findingsToTasks([lintWarn], { minSeverity: "warn" })).toHaveLength(1);
});