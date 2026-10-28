import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("巡检基线工作树接线（作者锁定）", () => {
  const src = readFileSync(new URL("../../src/cli-commands/loop-core.ts", import.meta.url), "utf8");

  it("巡检曲线不再拿主工作区当基线，且主工作区被硬护栏挡住", () => {
    expect(src).not.toContain("baselineCwd: context.repoRoot");
    expect(src).toContain("baselineFlowId");
    expect(src).toMatch(/patrol-base-/);
    expect(src).toContain("不得在主工作区执行");
  });

  it("回归库隔离数进巡检日志", () => {
    expect(src).toContain("listQuarantined");
  });
});