import { expect, test } from "vitest";
import type { Finding } from "../../src/loop/guardian.js";
import { findingToTask, findingsToTasks } from "../../src/feedback/finding-to-task.js";

test("findingToTask 指纹不含行号——同问题不同行号指纹相同", () => {
  const a: Finding = { scanner: "typecheck", severity: "error", file: "src/a.ts", line: 12, message: "TS2322: type mismatch" };
  const b: Finding = { ...a, line: 31 };

  expect(findingToTask(a).fingerprint).toBe(findingToTask(b).fingerprint);
});

test("findingsToTasks 缺省只留 error（warn/info 不再自动建流，降飞轮噪声）", () => {
  const findings: Finding[] = [
    { scanner: "todo", severity: "info", file: "src/a.ts", line: 1, message: "TODO: later" },
    { scanner: "sync-fs", severity: "warn", file: "src/b.ts", line: 2, message: "readFileSync(" },
    { scanner: "typecheck", severity: "error", file: "src/c.ts", line: 3, message: "TS2322" },
  ];

  const tasks = findingsToTasks(findings);

  expect(tasks).toHaveLength(1);
  expect(tasks.map((t) => t.severity)).toEqual(["error"]);
});

test("findingsToTasks 显式 minSeverity:warn 仍纳入 warn（参数行为不变）", () => {
  const findings: Finding[] = [
    { scanner: "sync-fs", severity: "warn", file: "src/b.ts", line: 2, message: "readFileSync(" },
    { scanner: "typecheck", severity: "error", file: "src/c.ts", line: 3, message: "TS2322" },
  ];

  const tasks = findingsToTasks(findings, { minSeverity: "warn" });

  expect(tasks.map((t) => t.severity)).toEqual(["warn", "error"]);
});

test("findingsToTasks 按指纹去重", () => {
  const findings: Finding[] = [
    { scanner: "typecheck", severity: "error", file: "src/a.ts", line: 12, message: "TS2322: type mismatch" },
    { scanner: "typecheck", severity: "error", file: "src/a.ts", line: 31, message: "TS2322: type mismatch" },
  ];

  expect(findingsToTasks(findings)).toHaveLength(1);
});

test("requirement 含来源/文件/消息且要求只改代码", () => {
  const task = findingToTask({
    scanner: "typecheck",
    severity: "error",
    file: "src/a.ts",
    line: 12,
    message: "TS2322: type mismatch",
  });

  expect(task.requirement).toContain("typecheck");
  expect(task.requirement).toContain("src/a.ts");
  expect(task.requirement).toContain("TS2322");
  expect(task.requirement).toContain("不要改验收命令");
});
