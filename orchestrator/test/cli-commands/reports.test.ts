import { describe, it, expect } from "vitest";
import "../../src/cli-commands/reports.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { isRecord } from "../../src/cli-commands/shared.js";

describe("报表/度量命令组析出到 CLI 注册表", () => {
  it("注册了 burn-forecast/cost-report/weekly/failures/savings/escape-rate/status", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["burn-forecast", "cost-report", "weekly", "failures", "savings", "escape-rate", "status"]) {
      expect(names).toContain(name);
    }
  });

  it("shared.isRecord 语义与原实现一致", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});