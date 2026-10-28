import { describe, it, expect } from "vitest";
import "../../src/cli-commands/ops.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { cliSource } from "../helpers/cli-source.js";

describe("kunpeng ops 命令接线（源级断言）", () => {
  const cli = cliSource();

  it("ops 命令存在且走 duePlaybooks/createOpsGate/launchKunpeng 三件套", () => {
    expect(cli).toContain('"ops"');
    expect(cli).toContain("duePlaybooks");
    expect(cli).toContain("createOpsGate");
    expect(cli.indexOf("loopRunArgs")).toBeGreaterThan(-1);
  });

  it("launchd 安装带环境注入与专属 label", () => {
    expect(cli).toContain("com.kunpeng.ops");
    const opsIdx = cli.indexOf("com.kunpeng.ops");
    const seg = cli.slice(Math.max(0, opsIdx - 4000), opsIdx + 4000);
    expect(seg).toContain("KUNPENG_BACKEND");
  });

  it("帮助文本含 ops", () => {
    expect(/命令:[^\n]*ops/.test(cli)).toBe(true);
  });

  it("ops/ops-pilot/ops-report 已在 CLI 注册表注册(行为断言)", () => {
    const names = listCliCommands().map((command) => command.name);
    for (const name of ["ops", "ops-pilot", "ops-report"]) {
      expect(names).toContain(name);
    }
  });
});