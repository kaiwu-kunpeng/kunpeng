import { expect, test } from "vitest";
import { aggregateStageDurations, buildStageBottlenecks } from "../src/perf/stage-duration.js";

test("跨 flow 汇总每阶段耗时,done 归并到 commit,末段用 updatedAt", () => {
  const flows = [
    { history: [
      { stage: "spec", at: 1000 },
      { stage: "implement", at: 1500 },
      { stage: "verify", at: 1800 },
    ], updatedAt: 2000 },
    { history: [
      { stage: "spec", at: 0 },
      { stage: "done", at: 100 },
    ], updatedAt: 300 },
  ];
  const d = aggregateStageDurations(flows, 9999);
  expect(d.spec).toBe(600);       // 500 + 100
  expect(d.implement).toBe(300);
  expect(d.verify).toBe(200);     // 2000 - 1800
  expect(d.commit).toBe(200);     // done->commit: 300 - 100
});

test("末段无 updatedAt 时用传入的 now 收口;空/缺 history 不抛错", () => {
  const flows = [
    { history: [{ stage: "audit", at: 5000 }] }, // 无 updatedAt
    { history: [] },
    {},
  ];
  const d = aggregateStageDurations(flows as { history?: { stage: string; at: number }[]; updatedAt?: number }[], 5300);
  expect(d.audit).toBe(300); // 5300 - 5000
});

test("buildStageBottlenecks 按 ms 降序取 topN,token 进 bytes,并列稳定", () => {
  const durations = { spec: 600, implement: 300, verify: 200, commit: 200, audit: 300 };
  const tokens = { spec: 50, implement: 10 };
  const profile = buildStageBottlenecks(durations, tokens, 2);
  expect(profile.bottlenecks.length).toBe(2);
  expect(profile.bottlenecks[0].label).toBe("spec");
  expect(profile.bottlenecks[0].ms).toBe(600);
  expect(profile.bottlenecks[0].bytes).toBe(50);
  // 300 并列:implement 在 audit 之前(插入序在前),topN=2 取到 implement
  expect(profile.bottlenecks[1].label).toBe("implement");
  expect(profile.totalMs).toBe(1600);
});

test("topN 缺省为 5", () => {
  const durations = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
  const profile = buildStageBottlenecks(durations);
  expect(profile.bottlenecks.length).toBe(5);
  expect(profile.bottlenecks[0].label).toBe("f");
});