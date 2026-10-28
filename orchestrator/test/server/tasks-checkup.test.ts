import { expect, test } from "vitest";
import { renderTasks } from "../../src/server/ui/views/tasks.js";

test("renders paradigm checkup bar with distinct ck-* classes", () => {
  const html = renderTasks([
    { id: "a", requirement: "短需求一", status: "running", history: [] },
    { id: "b", requirement: "短需求二", status: "verified", history: [] },
  ]);
  expect(html).toContain("范式体检");
  expect(html).toContain("tb-bar");
  expect(html).toContain("ck-l3");
  expect(html).toContain("自主率");
});

test("all short autonomous flows -> 自主率 100%", () => {
  const html = renderTasks([
    { id: "a", requirement: "短一", status: "running", history: [] },
    { id: "b", requirement: "短二", status: "running", history: [] },
    { id: "c", requirement: "短三", status: "running", history: [] },
  ]);
  expect(html).toContain("自主率 100%");
  expect(html).toContain("L3 3");
});

test("gate-heavy flow shows up as L1 in distribution", () => {
  const history = Array.from({ length: 8 }, () => ({ stage: "gate-cleared" }));
  const html = renderTasks([
    { id: "x", requirement: "r", status: "running", history },
  ]);
  expect(html).toContain("L1 1");
  expect(html).toContain("自主率 0%");
});

test("panel uses ck-* not extra lvl-* so row badges stay discriminating", () => {
  // 面板用 ck-l1/ck-l2/ck-l3,行徽章才是 lvl-*;一个纯 L3 列表里不应出现 lvl-l1
  const html = renderTasks([{ id: "a", requirement: "短", status: "running", history: [] }]);
  expect(html).toContain("ck-l1");      // 面板永远有 L1 计数 chip
  expect(html).not.toContain("lvl-l1"); // 但没有 L1 行
});