import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assignSet,
  epochForTime,
  RegressionStore,
  type RegressionTask,
} from "../../src/evolution/regression-store.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-holdout-rotation-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function task(id: string): RegressionTask {
  return {
    id,
    requirement: `requirement ${id}`,
    acceptanceCmd: `test ${id}`,
    sourceFlow: id,
    set: assignSet(id),
    createdAt: 12345,
  };
}

describe("assignSet epoch rotation", () => {
  test("keeps epoch 0 compatible and changes at least one flow at epoch 1", () => {
    const flow = "flow-compatible";

    expect(assignSet(flow, 0)).toBe(assignSet(flow));

    let flipped: string | undefined;
    for (let i = 0; i < 1_000; i += 1) {
      const candidate = `flow-rotation-${i}`;
      if (assignSet(candidate, 0) !== assignSet(candidate, 1)) {
        flipped = candidate;
        break;
      }
    }

    expect(flipped).toBeDefined();
    expect(assignSet(flipped!, 0)).not.toBe(assignSet(flipped!, 1));
  });
});

describe("epochForTime", () => {
  test("maps timestamps into fixed 30 day epochs", () => {
    expect(epochForTime(0)).toBe(0);
    expect(epochForTime(30 * 86400000)).toBe(1);
    expect(epochForTime(31 * 86400000, 30 * 86400000)).toBe(1);
  });
});

describe("RegressionStore holdout rotation", () => {
  test("sediments at epoch 0, rotates all tasks, persists epoch, and keeps .epoch out of list", async () => {
    const store = new RegressionStore(dir);
    const tasks = [
      task("flow-one"),
      task("flow-two"),
      task("flow-three"),
      task("flow-four"),
      task("flow-five"),
    ];

    for (const item of tasks) {
      await expect(store.sediment(item)).resolves.toBe(true);
    }

    expect(await store.currentEpoch()).toBe(0);
    const listedAtEpoch0 = await store.list();
    expect(listedAtEpoch0).toHaveLength(tasks.length);
    expect(listedAtEpoch0.map((item) => item.set)).toEqual(
      listedAtEpoch0.map((item) => assignSet(item.sourceFlow, 0)),
    );

    const rotated = await store.rotate(1);

    expect(rotated.epoch).toBe(1);
    expect(rotated.holdout + rotated.optimization).toBe(tasks.length);
    expect(await store.currentEpoch()).toBe(1);

    const listedAtEpoch1 = await store.list();
    expect(listedAtEpoch1).toHaveLength(tasks.length);
    for (const item of listedAtEpoch1) {
      expect(item.set).toBe(assignSet(item.sourceFlow, 1));
    }
  });
});
