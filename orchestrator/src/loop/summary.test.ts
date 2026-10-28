import { expect, test } from "vitest";
import { readableSubject, summarizeLoop } from "./summary.js";
import type { LoopDef, Wave } from "./types.js";

function wave(overrides: Partial<Wave> = {}): Wave {
  return {
    seq: 1,
    at: 100,
    lever: "model-expand",
    subject: "Radiator",
    metricDelta: 1,
    metricAfter: 1,
    verified: true,
    ...overrides,
  };
}

function loop(overrides: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "loop-1",
    name: "Loop One",
    projectId: "project-1",
    recipe: "acme-catalog",
    metric: { key: "parts", label: "parts-with-quote", current: 500 },
    levers: [
      { id: "model-expand", label: "扩车型", status: "active" },
      { id: "x", label: "开新品类", status: "active" },
    ],
    waves: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

test("summarizeLoop reports acceleration from recent five waves", () => {
  const waves = [
    ...Array.from({ length: 5 }, (_, i) => wave({ seq: i + 1, metricDelta: 10, metricAfter: 400 + i * 10 })),
    ...Array.from({ length: 5 }, (_, i) => wave({ seq: i + 6, metricDelta: 20, metricAfter: 420 + i * 20 })),
  ];

  const insight = summarizeLoop(loop({ waves }));

  expect(insight.trend).toContain("+100");
  expect(insight.trend).toContain("至 500");
  expect(insight.trend).toContain("加速");
});

test("summarizeLoop reports stagnation and recommends changing lever", () => {
  const waves = Array.from({ length: 5 }, (_, i) => wave({ seq: i + 1, metricDelta: 0, metricAfter: 500 }));

  const insight = summarizeLoop(loop({ waves }));

  expect(insight.trend).toContain("停滞");
  expect(insight.next).toContain("换杠杆");
});

test("readableSubject extracts enumName from JSON and preserves non JSON subjects", () => {
  expect(readableSubject(wave({ subject: "{\"enumName\":\"GAS_CAP\",\"slug\":\"gas-cap\"}" }))).toBe("GAS_CAP");
  expect(readableSubject(wave({ subject: "价格页标题" }))).toBe("价格页标题");
});

test("summarizeLoop de-duplicates recent readable subjects in order", () => {
  const waves = [
    wave({ seq: 1, subject: "{\"enumName\":\"WIPER_BLADE\"}" }),
    wave({ seq: 2, subject: "{\"enumName\":\"WIPER_BLADE\"}" }),
    wave({ seq: 3, subject: "{\"enumName\":\"WIPER_BLADE\"}" }),
    wave({ seq: 4, subject: "{\"enumName\":\"PCV_VALVE\"}" }),
    wave({ seq: 5, subject: "{\"enumName\":\"PCV_VALVE\"}" }),
  ];

  const recent = summarizeLoop(loop({ waves })).recent;

  expect(recent).toContain("WIPER_BLADE");
  expect(recent).toContain("PCV_VALVE");
  expect(recent.match(/WIPER_BLADE/g)).toHaveLength(1);
});

test("summarizeLoop reports blockers and reports healthy loops as no obvious blockers", () => {
  const blocked = loop({
    levers: [
      { id: "model-expand", label: "扩车型", status: "active" },
      { id: "stale", label: "旧杠杆", status: "honest-zero" },
    ],
    waves: [
      wave({ seq: 1, metricDelta: 0 }),
      wave({ seq: 2, metricDelta: 0 }),
      wave({ seq: 3, metricDelta: 5 }),
      wave({ seq: 4, metricDelta: 5 }),
      wave({ seq: 5, metricDelta: 5 }),
    ],
  });
  expect(summarizeLoop(blocked).blockers).toContain("2 轮零增量");
  expect(summarizeLoop(blocked).blockers).toContain("1 个杠杆诚实零");

  const healthy = loop({
    waves: Array.from({ length: 5 }, (_, i) => wave({ seq: i + 1, metricDelta: 5, verified: true })),
  });
  expect(summarizeLoop(healthy).blockers).toBe("无明显卡点");
});

test("summarizeLoop prefers scheduled next lever label", () => {
  const insight = summarizeLoop(loop({
    nextLever: { lever: "x" },
    waves: [wave({ seq: 1, metricDelta: 5 })],
  }));

  expect(insight.next).toContain("开新品类");
});

test("summarizeLoop handles empty waves", () => {
  const insight = summarizeLoop(loop({ waves: [] }));

  expect(insight.trend).toContain("暂无 wave");
  expect(insight.next).toContain("设定首个杠杆");
});
