import { describe, it, expect } from "vitest";
import "../../src/cli-commands/devcycle.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { runScopeCheck } from "../../src/cli.js";

describe("研发周期命令组析出到 CLI 注册表", () => {
  it("注册了 run/pause/resume/guard/audit/merge/scope-check", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["run", "pause", "resume", "guard", "audit", "merge", "scope-check"]) {
      expect(names).toContain(name);
    }
  });

  it("runScopeCheck 经 cli.js re-export:无 scope 声明 → skipped", async () => {
    const result = await runScopeCheck("# 无范围声明的 spec", process.cwd(), "no-such-flow");
    expect(result.status).toBe("skipped");
    expect(result.exitCode).toBe(0);
  });
});