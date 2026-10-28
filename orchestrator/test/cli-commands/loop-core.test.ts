import { describe, it, expect, vi } from "vitest";
import "../../src/cli-commands/loop-core.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { recordLoopWave } from "../../src/cli.js";

describe("核心驱动命令组析出到 CLI 注册表(最后一组)", () => {
  it("注册了 loop/plan/autopilot/patrol", () => {
    const names = listCliCommands().map((c) => c.name);
    for (const name of ["loop", "plan", "autopilot", "patrol"]) {
      expect(names).toContain(name);
    }
  });

  it("recordLoopWave 经 cli.js re-export:未验证 wave 镜像为 rolled-back", async () => {
    const appendWave = vi.fn().mockResolvedValue({ seq: 3, at: 1, lever: "l", subject: "s", metricDelta: 1, metricAfter: 2, verified: false });
    const start = vi.fn().mockResolvedValue(undefined);
    const finish = vi.fn().mockResolvedValue(undefined);
    const result = await recordLoopWave(
      { id: "lp", lever: "l", subject: "s", delta: 1, after: 2, verified: false },
      { store: { appendWave }, tracker: { start, finish }, now: () => 1 },
    );
    expect(result.flowId).toBe("loop-lp-w3");
    expect(finish).toHaveBeenCalledWith(
      "loop-lp-w3",
      "rolled-back",
      undefined,
      expect.stringContaining("[loop-wave-unverified]"),
    );
  });
});
