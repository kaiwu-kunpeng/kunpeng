import { describe, expect, test } from "vitest";
import { findingsToTasks } from "../../src/feedback/finding-to-task.js";
import type { Finding } from "../../src/loop/guardian.js";

describe("findingsToTasks 定位守卫:无 file/line 的噪声发现不入队", () => {
  test("eslint 汇总/横幅/路径行(无 file:line)→ 不产生任务", () => {
    const noise: Finding[] = [
      { scanner: "lint", severity: "error", message: "✖ 37 problems (3 errors, 34 warnings)" },
      { scanner: "lint", severity: "error", message: "2 errors and 0 warnings potentially fixable with the `--fix` option." },
      { scanner: "lint", severity: "error", message: "/Users/x/kunpeng/orchestrator/src/foo.ts" },
    ];
    expect(findingsToTasks(noise, { minSeverity: "error" })).toEqual([]);
  });

  test("有 file+line 的真发现 → 正常产生任务,requirement 带定位", () => {
    const real: Finding[] = [
      { scanner: "typecheck", severity: "error", file: "src/a.ts", line: 12, message: "TS2322 type error" },
    ];
    const tasks = findingsToTasks(real, { minSeverity: "error" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].requirement).toContain("src/a.ts:12");
  });

  test("混合:噪声被滤掉,只保留有定位的", () => {
    const mixed: Finding[] = [
      { scanner: "lint", severity: "error", message: "✖ 5 problems" },
      { scanner: "lint", severity: "error", file: "src/b.ts", line: 3, message: "real located error" },
    ];
    const tasks = findingsToTasks(mixed, { minSeverity: "error" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].requirement).toContain("src/b.ts:3");
  });

  test("line 为 0 也算有定位(真实第0行罕见但不应误杀);仅 undefined 才是噪声", () => {
    const edge: Finding[] = [
      { scanner: "typecheck", severity: "error", file: "src/c.ts", line: 0, message: "edge" },
    ];
    expect(findingsToTasks(edge, { minSeverity: "error" })).toHaveLength(1);
  });
});