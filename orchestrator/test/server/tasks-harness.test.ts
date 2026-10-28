import { expect, test } from "vitest";
import { renderTasks } from "../../src/server/ui/views/tasks.js";

test("renders Harness 护栏 summary with full/total ratio", () => {
  const html = renderTasks([
    { id: "a", requirement: "短一", status: "verified", planId: "p1", history: [{ stage: "verify" }] },
    { id: "b", requirement: "短二", status: "running", history: [] },
  ]);
  expect(html).toContain("Harness 护栏");
  expect(html).toContain("1/2 流跑满 4 锁");
  expect(html).toContain("确定性检索");
});

test("empty board shows 0/0", () => {
  const html = renderTasks([]);
  expect(html).toContain("0/0 流跑满 4 锁");
});