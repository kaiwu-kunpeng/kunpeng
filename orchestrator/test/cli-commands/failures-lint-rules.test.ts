import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reports = readFileSync(new URL("../../src/cli-commands/reports.ts", import.meta.url), "utf8");
const specTools = readFileSync(new URL("../../src/cli-commands/spec-tools.ts", import.meta.url), "utf8");
const loopCore = readFileSync(new URL("../../src/cli-commands/loop-core.ts", import.meta.url), "utf8");

describe("kunpeng failures --lint-rules 接线（作者锁定）", () => {
  it("failures 命令识别 --lint-rules 并调用 writeRecurrenceRules", () => {
    expect(reports).toContain("--lint-rules");
    expect(reports).toContain("writeRecurrenceRules(");
    expect(reports).toContain("spec-lint 规则已写入");
    expect(reports).toMatch(/lintRules/);
  });

  it("info 等级不进 --strict 与 plan 的阻断判定（消费方只看 error/warn）", () => {
    expect(specTools).toContain('item.level === "warn"');
    expect(specTools).not.toContain('"info"');
    expect(loopCore).not.toContain('"info"');
  });
});