import { expect, test } from "vitest";
import { buildTaskBoard, type TaskBoardFlow } from "../../src/cockpit/task-board.js";

const flows: TaskBoardFlow[] = [
  { id: "f1", requirement: "加登录", status: "running", project: "p1", model: "codex", tokens: 5000, costUsd: 0.12, level: "L3", ageMs: 30_000 },
  { id: "f2", requirement: "修 bug", status: "verified", project: "p2", model: "opus", tokens: 20000, costUsd: 0.40, level: "L2", ageMs: 7_200_000 },
  { id: "f3", requirement: "重构", status: "running", project: "p1", model: "codex", tokens: 1000, costUsd: 0.02, ageMs: 120_000 },
];

test("rows format cost, level, age", () => {
  const { rows } = buildTaskBoard(flows, { sortBy: "tokens" });
  expect(rows[0].id).toBe("f2");          // tokens 降序
  expect(rows[0].cost).toBe("$0.4000");
  expect(rows[0].level).toBe("L2");
  expect(rows[0].age).toBe("2h");
  const f3row = rows.find((r) => r.id === "f3")!;
  expect(f3row.level).toBe("—");          // 无 metrics
  expect(f3row.age).toBe("2m");
});

test("default sort is newest-first by age", () => {
  const { rows } = buildTaskBoard(flows);
  expect(rows.map((r) => r.id)).toEqual(["f1", "f3", "f2"]);
});

test("summary aggregates status/level/cost", () => {
  const { summary } = buildTaskBoard(flows);
  expect(summary.total).toBe(3);
  expect(summary.byStatus.running).toBe(2);
  expect(summary.byStatus.verified).toBe(1);
  expect(summary.byLevel.L3).toBe(1);
  expect(summary.byLevel["—"]).toBe(1);
  expect(summary.totalCostUsd).toBeCloseTo(0.54, 6);
});