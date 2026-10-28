import { describe, it, expect } from "vitest";
import "../../src/cli-commands/maintain-guardian.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { planMaintainLessons } from "../../src/cli.js";

describe("维护/守护命令组析出到 CLI 注册表", () => {
  it("注册了 maintain/apply/guardian-report", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["maintain", "apply", "guardian-report"]) {
      expect(names).toContain(name);
    }
  });

  it("planMaintainLessons 经 cli.js re-export 语义不变(空输入)", () => {
    expect(planMaintainLessons([])).toEqual({ merges: [], graduateCount: 0, retireCount: 0 });
  });
});