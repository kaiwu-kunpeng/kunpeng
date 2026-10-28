import { describe, it, expect } from "vitest";
import "../../src/cli-commands/flywheel-eval.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { isProposalRouteTerminalStatus } from "../../src/cli.js";

describe("飞轮/评测命令组析出到 CLI 注册表", () => {
  it("注册了 reinject/flywheel/evolve/evaluate/best-of-n", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["reinject", "flywheel", "evolve", "evaluate", "best-of-n"]) {
      expect(names).toContain(name);
    }
  });

  it("isProposalRouteTerminalStatus 经 cli.js re-export 语义不变", () => {
    expect(isProposalRouteTerminalStatus("auto-enqueued", "draft")).toBe(true);
    expect(isProposalRouteTerminalStatus(undefined, "verified")).toBe(true);
    expect(isProposalRouteTerminalStatus("approved", "draft")).toBe(false);
    expect(isProposalRouteTerminalStatus("rolled-back", "draft")).toBe(false);
  });
});