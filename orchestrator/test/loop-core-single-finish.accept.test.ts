import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { recordLoopWave } from "../src/cli-commands/loop-core.js";

const source = readFileSync(new URL("../src/cli-commands/loop-core.ts", import.meta.url), "utf8");

function deps(finish: ReturnType<typeof vi.fn>) {
  return {
    store: {
      appendWave: vi.fn().mockResolvedValue({
        seq: 3, at: 1, lever: "l", subject: "s", metricDelta: 1, metricAfter: 2, verified: false,
      }),
    },
    tracker: { start: vi.fn().mockResolvedValue(undefined), finish },
    now: () => 1,
  };
}

describe("recordLoopWave 收尾必须只调一次 finish", () => {
  test("未验证波：恰好一次，四参且带前缀", async () => {
    const finish = vi.fn().mockResolvedValue(undefined);
    await recordLoopWave(
      { id: "lp", lever: "l", subject: "s", delta: 1, after: 2, verified: false },
      deps(finish) as never,
    );
    expect(finish).toHaveBeenCalledTimes(1);
    const call = finish.mock.calls[0];
    expect(call[1]).toBe("rolled-back");
    expect(String(call[3])).toContain("[loop-wave-unverified]");
  });

  test("已验证波：恰好一次，两参", async () => {
    const finish = vi.fn().mockResolvedValue(undefined);
    await recordLoopWave(
      { id: "lp", lever: "l", subject: "s", delta: 1, after: 2, verified: true },
      deps(finish) as never,
    );
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0][1]).toBe("verified");
    expect(finish.mock.calls[0].length).toBe(2);
  });

  test("源码里不得再有以测试环境为判据的分支", () => {
    expect(source).not.toContain("deps.stateDir === undefined");
  });

  test("appendWave 的返回值不得被加兜底（失败必须暴露，不得静默降级为 seq:0）", () => {
    expect(source).toContain("const wave = await deps.store.appendWave(input.id, waveWithoutSeq);");
    expect(source).not.toContain("seq: 0");
  });
});