import { expect, test } from "vitest";

import {
  checkGateConservation,
  classifyGate,
  computeAutoCompletion,
  computeTokenTrend,
} from "../../src/metrics/metrics";

test("computeAutoCompletion counts terminal verified and intervention statuses", () => {
  expect(
    computeAutoCompletion([
      { status: "verified" },
      { status: "verified" },
      { status: "verified" },
      { status: "rolled-back" },
      { status: "crashed" },
      { status: "running" },
      { status: "running" },
    ]),
  ).toEqual({
    attempted: 5,
    autoCompleted: 3,
    neededIntervention: 2,
    rate: 0.6,
    target: 0.8,
    meetsTarget: false,
  });
});

test("computeAutoCompletion reports target met for all verified flows", () => {
  expect(
    computeAutoCompletion([{ status: "verified" }, { status: "verified" }]),
  ).toMatchObject({
    attempted: 2,
    autoCompleted: 2,
    neededIntervention: 0,
    rate: 1,
    meetsTarget: true,
  });
});

test("computeAutoCompletion treats no attempts as perfect rate", () => {
  expect(computeAutoCompletion([])).toEqual({
    attempted: 0,
    autoCompleted: 0,
    neededIntervention: 0,
    rate: 1,
    target: 0.8,
    meetsTarget: true,
  });
});

test("computeTokenTrend reports down when recent verified token average drops", () => {
  expect(
    computeTokenTrend([
      { status: "verified", tokensUsed: 1000, updatedAt: 1 },
      { status: "verified", tokensUsed: 800, updatedAt: 2 },
      { status: "verified", tokensUsed: 400, updatedAt: 3 },
      { status: "verified", tokensUsed: 300, updatedAt: 4 },
      { status: "rolled-back", tokensUsed: 1, updatedAt: 5 },
      { status: "verified", tokensUsed: 0, updatedAt: 6 },
    ]),
  ).toEqual({
    samples: 4,
    avgTokensPerReq: 625,
    olderAvg: 900,
    recentAvg: 350,
    trend: "down",
  });
});

test("computeTokenTrend keeps one valid sample flat", () => {
  expect(
    computeTokenTrend([
      { status: "verified", tokensUsed: 500, updatedAt: 1 },
      { status: "crashed", tokensUsed: 100, updatedAt: 2 },
    ]),
  ).toEqual({
    samples: 1,
    avgTokensPerReq: 500,
    olderAvg: 0,
    recentAvg: 500,
    trend: "flat",
  });
});

test("computeTokenTrend returns flat zero summary when no token samples qualify", () => {
  expect(
    computeTokenTrend([
      { status: "verified", tokensUsed: 0, updatedAt: 1 },
      { status: "verified", updatedAt: 2 },
      { status: "running", tokensUsed: 100, updatedAt: 3 },
    ]),
  ).toEqual({
    samples: 0,
    avgTokensPerReq: 0,
    recentAvg: 0,
    olderAvg: 0,
    trend: "flat",
  });
});

test("classifyGate recognizes the three constitutional human gates", () => {
  expect(classifyGate({ gate: "合并主干", what: "→ main" })).toBe("合并主干");
  expect(classifyGate({ gate: "改宪法", what: "角色卡" })).toBe("改宪法");
  expect(classifyGate({ gate: "对外发布", what: "release" })).toBe("对外发布");
  expect(classifyGate({ gate: "神秘门", what: "xyz" })).toBe("unknown");
});

test("checkGateConservation accepts only the three legal gate classes", () => {
  expect(
    checkGateConservation([
      { gate: "合并主干", what: "→ main" },
      { gate: "改宪法", what: "角色卡" },
      { gate: "对外发布", what: "release" },
    ]),
  ).toMatchObject({
    ok: true,
    violations: [],
  });

  const unknown = { gate: "神秘门", what: "xyz" };
  expect(
    checkGateConservation([
      { gate: "合并主干", what: "→ main" },
      unknown,
    ]),
  ).toEqual({
    ok: false,
    allowed: ["合并主干", "改宪法", "对外发布"],
    violations: [unknown],
  });
});
