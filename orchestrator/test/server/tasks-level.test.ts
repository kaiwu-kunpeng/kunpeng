import { expect, test } from "vitest";
import { renderTasks } from "../../src/server/ui/views/tasks.js";

test("derives L3 badge from a real short autonomous flow (no explicit level)", () => {
  const html = renderTasks([
    { id: "f1", requirement: "加登录页", status: "running", project: { name: "web" }, tokensUsed: 5000, elapsedMs: 120000, history: [{ stage: "implement" }] },
  ]);
  expect(html).toContain("lvl-l3");   // 真派生,非"—"
  expect(html).not.toContain("lvl-none");
});

test("gate-heavy flow derives L1 badge", () => {
  const history = Array.from({ length: 8 }, () => ({ stage: "gate-cleared" }));
  const html = renderTasks([
    { id: "f2", requirement: "r", status: "running", history },
  ]);
  expect(html).toContain("lvl-l1");
});

test("explicit level overrides derivation", () => {
  const html = renderTasks([
    { id: "f3", requirement: "加登录页", status: "running", level: "L2", history: [] },
  ]);
  expect(html).toContain("lvl-l2");
});

test("L3 KPI counts derived autonomous flows", () => {
  const html = renderTasks([
    { id: "a", requirement: "短需求一", status: "running", history: [] },
    { id: "b", requirement: "短需求二", status: "verified", history: [] },
  ]);
  expect(html).toContain("L3 端到端");
});