import { expect, test } from "vitest";
import { renderTasks, estimateCost } from "../../src/server/ui/views/tasks.js";

test("reads real tokensUsed and renders a cost column", () => {
  const html = renderTasks([
    { id: "f1", requirement: "加登录页", status: "running", project: { name: "web" }, stageBackends: { spec: "opus", implement: "codex" }, tokensUsed: 1_000_000, elapsedMs: 120000 },
  ]);
  expect(html).toContain("1000000");     // 真 tokens
  expect(html).toContain("$6.0000");     // 估价成本列
  expect(html).toContain("codex");       // 真模型(stageBackends 最后一个)
  expect(html).toContain("成本");        // 列头
});

test("estimateCost is $6 per 1M tokens", () => {
  expect(estimateCost(1_000_000)).toBeCloseTo(6, 6);
  expect(estimateCost(0)).toBe(0);
});

test("keeps rich markup + escapes + empty state colspan 8", () => {
  const html = renderTasks([
    { id: "f1", requirement: "加登录页", status: "running", project: { name: "web" }, tokensUsed: 5000, elapsedMs: 120000 },
    { id: "f2", requirement: "修空指针", status: "verified", project: { name: "api" }, tokensUsed: 20000, elapsedMs: 7200000 },
  ]);
  // 每个真实 flow 现都派生等级:短自主流落 L3(原 lvl-none 断言已失效)
  for (const s of ["task-board", "section-h", "tb-kpis", "tb-table", "tag-info", "tag-ok", "lvl-l3"]) expect(html).toContain(s);
  const evil = renderTasks([{ id: "x", requirement: "<script>x</script>", status: "running" }]);
  expect(evil).not.toContain("<script>x</script>");
  expect(renderTasks([])).toContain('colspan="8"');
  expect(renderTasks([])).toContain("暂无运行中的流");
});
