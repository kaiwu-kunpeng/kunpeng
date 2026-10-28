import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("接线（作者锁定）", () => {
  test("cli-runner 两处 TESTCMD 解析都改用 parseTestCmdLine", () => {
    const src = readFileSync(new URL("../../src/agent/cli-runner.ts", import.meta.url), "utf8");
    expect(src).toMatch(/import \{[^}]*parseTestCmdLine[^}]*\} from "\.\/testcmd\.js"/);
    expect((src.match(/parseTestCmdLine\(/g) ?? []).length).toBe(2);
    expect(src).not.toContain("TESTCMD:[");
  });
  test("run 命令用 resolveRunAcceptance 决定验收命令", () => {
    const src = readFileSync(new URL("../../src/cli-commands/devcycle.ts", import.meta.url), "utf8");
    expect(src).toContain("acceptanceCmd: resolveRunAcceptance(context.acceptArg, requirement)");
    expect(src).not.toContain("acceptanceCmd: context.acceptArg,");
  });
});