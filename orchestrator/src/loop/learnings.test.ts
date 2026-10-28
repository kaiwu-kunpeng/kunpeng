import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { deriveLearning, LoopLearningStore, type Learning } from "./learnings.js";
import type { Wave } from "./types.js";

function wave(overrides: Partial<Wave> = {}): Wave {
  return {
    seq: 1,
    at: 0,
    lever: "model-expand",
    subject: "RADIATOR",
    metricDelta: 5,
    metricAfter: 15,
    verified: true,
    ...overrides,
  };
}

describe("deriveLearning", () => {
  test("marks zero priced suppliers as weak with readable category subject", () => {
    const learning = deriveLearning(wave({
      lever: "new-category",
      subject: "{\"enumName\":\"VAPOR_CANISTER\"}",
      metricDelta: 0,
      metricAfter: 5,
      detail: "VAPOR_CANISTER new-category: 8 pages, 42 candidates, 0 priced suppliers",
    }));

    expect(learning?.kind).toBe("weak");
    expect(learning?.lesson).toContain("VAPOR_CANISTER");
    expect(learning?.lesson).toContain("带价");
  });

  test("marks unverified zero delta as blocked", () => {
    const learning = deriveLearning(wave({ metricDelta: 0, verified: false }));

    expect(learning?.kind).toBe("blocked");
    expect(learning?.lesson).toContain("未验证");
  });

  test("marks verified zero delta as blocked", () => {
    const learning = deriveLearning(wave({ metricDelta: 0, verified: true, detail: "no growth" }));

    expect(learning?.kind).toBe("blocked");
    expect(learning?.lesson).toContain("零增量");
  });

  test("marks large deltas as wins", () => {
    const learning = deriveLearning(wave({ metricDelta: 41, metricAfter: 51 }));

    expect(learning?.kind).toBe("win");
    expect(learning?.lesson).toContain("+41");
  });

  test("ignores small deltas without gotchas", () => {
    expect(deriveLearning(wave({ metricDelta: 5 }))).toBeNull();
  });

  test("records gotchas for small deltas", () => {
    const learning = deriveLearning(wave({ metricDelta: 5, gotchas: ["x 限制"] }));

    expect(learning?.kind).toBe("note");
    expect(learning?.lesson).toContain("x 限制");
  });
});

describe("LoopLearningStore", () => {
  test("roundtrips recent learnings with newest first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunpeng-learnings-"));
    const store = new LoopLearningStore(dir);
    const first: Learning = {
      at: 1,
      waveSeq: 1,
      lever: "model-expand",
      subject: "RADIATOR",
      kind: "blocked",
      lesson: "RADIATOR：零增量",
    };
    const second: Learning = {
      at: 2,
      waveSeq: 2,
      lever: "new-category",
      subject: "VAPOR_CANISTER",
      kind: "weak",
      lesson: "VAPOR_CANISTER：候选供应商全无带价",
    };

    await store.append("loop-a", first);
    await store.append("loop-a", second);

    expect(await store.recent("loop-a")).toEqual([second, first]);
    expect(await store.recent("loop-a", 1)).toEqual([second]);
    expect(await store.recent("missing")).toEqual([]);
  });
});
