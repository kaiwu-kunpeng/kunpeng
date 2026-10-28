import { expect, test } from "vitest";
import type { TaskEstimate } from "../src/product/contract.js";
import { estimateProject, velocityFromHistory } from "../src/product/estimate.js";

test("velocityFromHistory 算比值", () => {
  expect(velocityFromHistory([{ estimateHours: 10, actualHours: 15 }])).toEqual([1.5]);
  expect(
    velocityFromHistory([
      { estimateHours: 0, actualHours: 15 },
      { estimateHours: 10, actualHours: 15 },
    ]),
  ).toEqual([1.5]);
});

test("同 seed 可复现", () => {
  const tasks: TaskEstimate[] = [
    { title: "a", estimateHours: 5 },
    { title: "b", estimateHours: 8 },
  ];

  const first = estimateProject(tasks, [], { seed: 42 });
  const second = estimateProject(tasks, [], { seed: 42 });

  expect(first.p50).toBe(second.p50);
});

test("分位单调 p50<=p80<=p95", () => {
  const tasks = Array.from({ length: 5 }, (_, index) => ({ title: `task-${index}`, estimateHours: 8 }));
  const forecast = estimateProject(tasks, [], { seed: 7 });

  expect(forecast.p50 <= forecast.p80 && forecast.p80 <= forecast.p95).toBe(true);
});

test("无历史→calibrated false 但仍出预测", () => {
  const forecast = estimateProject([{ title: "a", estimateHours: 10 }], []);

  expect(forecast.calibrated).toBe(false);
  expect(forecast.expectedHours).toBeGreaterThan(0);
});

test("有历史→calibrated true", () => {
  const forecast = estimateProject([{ title: "a", estimateHours: 10 }], [1.0, 1.2]);

  expect(forecast.calibrated).toBe(true);
});

test("空任务→全 0", () => {
  const forecast = estimateProject([], []);

  expect(forecast.expectedHours).toBe(0);
  expect(forecast.p50).toBe(0);
  expect(forecast.p80).toBe(0);
  expect(forecast.p95).toBe(0);
});

test("期望值落在合理区间", () => {
  const forecast = estimateProject([{ title: "a", estimateHours: 100 }], [1.0]);

  expect(forecast.expectedHours).toBe(100);
  expect(forecast.p50).toBe(100);
});
