import { describe, expect, test, vi } from "vitest";

import { pickNextTarget, runLoopAutopilot, type LoopAutopilotStep } from "../../src/loop/loop-autopilot.js";
import type { LoopDef, Wave } from "../../src/loop/types.js";

function loop(waves: Wave[] = []): LoopDef {
  return {
    id: "acme-catalog",
    name: "Acme Catalog",
    projectId: "acme-shop",
    recipe: "acme-catalog",
    metric: { key: "pwq", label: "PWQ", current: 0 },
    levers: [],
    waves,
    createdAt: 0,
    updatedAt: 0,
  };
}

function wave(subject: string, verified: boolean): Wave {
  return {
    seq: 1,
    at: 0,
    lever: "model-expand",
    subject,
    metricDelta: 1,
    metricAfter: 1,
    verified,
  };
}

describe("pickNextTarget", () => {
  test("skips targets that already have a verified wave", () => {
    expect(pickNextTarget(["A", "B", "C"], loop([wave("A", true)]), "model-expand")).toEqual({
      lever: "model-expand",
      target: "B",
    });
  });

  test("returns null when all targets already have verified waves", () => {
    expect(pickNextTarget(["A", "B"], loop([wave("A", true), wave("B", true)]), "model-expand")).toBeNull();
  });

  test("does not treat failed waves as done", () => {
    expect(pickNextTarget(["A", "B"], loop([wave("A", false)]), "model-expand")).toEqual({
      lever: "model-expand",
      target: "A",
    });
  });
});

describe("runLoopAutopilot", () => {
  test("runs serially until the wave budget is reached", async () => {
    let next = 0;
    let currentTarget = "";
    const order: string[] = [];
    const setNext = vi.fn(async (step: LoopAutopilotStep) => {
      currentTarget = step.target ?? step.lever;
      order.push(`set:${currentTarget}`);
    });
    const driveWave = vi.fn(async () => {
      order.push(`drive:${currentTarget}`);
      return { gated: false, verified: true, metricDelta: 1 };
    });

    const result = await runLoopAutopilot({
      loopId: "acme-catalog",
      maxWaves: 3,
      readLoop: async () => loop(),
      pickNext: () => ({ lever: "x", target: `t${++next}` }),
      setNext,
      driveWave,
    });

    expect(result.waves).toHaveLength(3);
    expect(result.stopReason).toBe("budget");
    expect(setNext).toHaveBeenCalledTimes(3);
    expect(driveWave).toHaveBeenCalledTimes(3);
    expect(order).toEqual(["set:t1", "drive:t1", "set:t2", "drive:t2", "set:t3", "drive:t3"]);
  });

  test("stops when a wave is not verified", async () => {
    let next = 0;
    const driveWave = vi
      .fn()
      .mockResolvedValueOnce({ gated: false, verified: true, metricDelta: 1 })
      .mockResolvedValueOnce({ gated: false, verified: false, metricDelta: 0 });

    const result = await runLoopAutopilot({
      loopId: "acme-catalog",
      maxWaves: 3,
      readLoop: async () => loop(),
      pickNext: () => ({ lever: "x", target: `t${++next}` }),
      setNext: async () => undefined,
      driveWave,
    });

    expect(result.waves).toHaveLength(2);
    expect(result.waves[1]?.verified).toBe(false);
    expect(result.stopReason).toBe("wave-failed");
    expect(driveWave).toHaveBeenCalledTimes(2);
  });

  test("classifies quota errors and stops", async () => {
    let next = 0;
    const driveWave = vi
      .fn()
      .mockResolvedValueOnce({ gated: false, verified: true, metricDelta: 1 })
      .mockRejectedValueOnce(new Error("xcrawl quota is not available"));

    const result = await runLoopAutopilot({
      loopId: "acme-catalog",
      maxWaves: 3,
      readLoop: async () => loop(),
      pickNext: () => ({ lever: "x", target: `t${++next}` }),
      setNext: async () => undefined,
      driveWave,
    });

    expect(result.stopReason).toBe("quota");
    expect(result.waves.at(-1)?.error).toContain("quota");
    expect(result.waves).toHaveLength(2);
    expect(driveWave).toHaveBeenCalledTimes(2);
  });

  test("stops when there is no next step", async () => {
    const driveWave = vi.fn();

    const result = await runLoopAutopilot({
      loopId: "acme-catalog",
      maxWaves: 3,
      readLoop: async () => loop(),
      pickNext: () => null,
      setNext: async () => undefined,
      driveWave,
    });

    expect(result.waves).toHaveLength(0);
    expect(result.stopReason).toBe("no-next-step");
    expect(driveWave).not.toHaveBeenCalled();
  });

  test("stops when the loop is missing", async () => {
    const pickNext = vi.fn();
    const setNext = vi.fn();
    const driveWave = vi.fn();

    const result = await runLoopAutopilot({
      loopId: "missing-loop",
      maxWaves: 3,
      readLoop: async () => null,
      pickNext,
      setNext,
      driveWave,
    });

    expect(result.waves).toHaveLength(0);
    expect(result.stopReason).toBe("loop-missing");
    expect(pickNext).not.toHaveBeenCalled();
    expect(setNext).not.toHaveBeenCalled();
    expect(driveWave).not.toHaveBeenCalled();
  });

  test("stops before reading the loop when a checkpoint asks to halt", async () => {
    const readLoop = vi.fn(async () => loop());
    const pickNext = vi.fn();
    const setNext = vi.fn();
    const driveWave = vi.fn();

    const result = await runLoopAutopilot({
      loopId: "acme-catalog",
      maxWaves: 3,
      readLoop,
      pickNext,
      setNext,
      driveWave,
      onCheckpoint: async () => true,
    });

    expect(result.waves).toHaveLength(0);
    expect(result.stopReason).toBe("stopped");
    expect(readLoop).not.toHaveBeenCalled();
    expect(pickNext).not.toHaveBeenCalled();
    expect(setNext).not.toHaveBeenCalled();
    expect(driveWave).not.toHaveBeenCalled();
  });

  test("checks for stop before each wave and does not start the next wave after halt", async () => {
    let next = 0;
    const order: string[] = [];
    const checkpoints = [false, true];
    const readLoop = vi.fn(async () => {
      order.push("read");
      return loop();
    });
    const setNext = vi.fn(async (step: LoopAutopilotStep) => {
      order.push(`set:${step.target ?? step.lever}`);
    });
    const driveWave = vi.fn(async () => {
      order.push("drive");
      return { gated: false, verified: true, metricDelta: 1 };
    });

    const result = await runLoopAutopilot({
      loopId: "acme-catalog",
      maxWaves: 3,
      readLoop,
      pickNext: () => {
        order.push("pick");
        return { lever: "x", target: `t${++next}` };
      },
      setNext,
      driveWave,
      onCheckpoint: () => {
        const halted = checkpoints.shift() ?? false;
        order.push(`checkpoint:${String(halted)}`);
        return halted;
      },
    });

    expect(result.stopReason).toBe("stopped");
    expect(result.waves).toHaveLength(1);
    expect(readLoop).toHaveBeenCalledTimes(1);
    expect(setNext).toHaveBeenCalledTimes(1);
    expect(driveWave).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["checkpoint:false", "read", "pick", "set:t1", "drive", "checkpoint:true"]);
  });

  test("stops when a wave is gated", async () => {
    const result = await runLoopAutopilot({
      loopId: "acme-catalog",
      maxWaves: 3,
      readLoop: async () => loop(),
      pickNext: () => ({ lever: "x", target: "t1" }),
      setNext: async () => undefined,
      driveWave: async () => ({ gated: true, verified: false }),
    });

    expect(result.stopReason).toBe("gated");
    expect(result.waves).toHaveLength(1);
    expect(result.waves[0]?.detail).toBe("gated");
  });

  test("classifies non-quota drive errors as error", async () => {
    const result = await runLoopAutopilot({
      loopId: "acme-catalog",
      maxWaves: 3,
      readLoop: async () => loop(),
      pickNext: () => ({ lever: "x", target: "t1" }),
      setNext: async () => undefined,
      driveWave: async () => {
        throw new Error("deploy failed");
      },
    });

    expect(result.stopReason).toBe("error");
    expect(result.waves).toHaveLength(1);
    expect(result.waves[0]?.error).toBe("deploy failed");
  });
});
