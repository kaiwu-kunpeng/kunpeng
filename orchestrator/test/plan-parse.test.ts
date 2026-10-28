import { expect, test } from "vitest";
import { parseMethodPlan } from "../src/plan/parse.js";

test("H2 sections each become a phase; section with no subheading/checklist = 1 flow", () => {
  const md = "# 标题\n\n## 数据层\n建表。\n\n## API\n写接口。\n";
  const m = parseMethodPlan(md);
  expect(m.phases.map((p) => p.title)).toEqual(["数据层", "API"]);
  expect(m.phases[0].flows).toHaveLength(1);
  expect(m.phases[0].flows[0].requirement).toContain("建表");
});

test("H3 under a phase → each H3 is a flow (adaptive深切)", () => {
  const md = "## 后端\n\n### 建表\n做 schema。\n\n### 接口\n做 route。\n";
  const m = parseMethodPlan(md);
  expect(m.phases).toHaveLength(1);
  expect(m.phases[0].flows.map((f) => f.title)).toEqual(["建表", "接口"]);
  expect(m.phases[0].flows[1].requirement).toContain("route");
});

test("phase with checklist → each item is a flow", () => {
  const md = "## 任务\n- [ ] 加登录\n- [ ] 加登出\n";
  const m = parseMethodPlan(md);
  expect(m.phases[0].flows.map((f) => f.title)).toEqual(["加登录", "加登出"]);
});

test("flat checklist, no headings → single default phase, item per flow", () => {
  const md = "- [ ] A\n- [ ] B\n";
  const m = parseMethodPlan(md);
  expect(m.phases).toHaveLength(1);
  expect(m.phases[0].title).toBe("default");
  expect(m.phases[0].flows).toHaveLength(2);
});

test("ids are deterministic (no timestamp) and unique within plan", () => {
  const md = "## 后端\n### 建表\nx\n### 接口\ny\n";
  const a = parseMethodPlan(md), b = parseMethodPlan(md);
  expect(a.phases[0].flows.map((f) => f.id)).toEqual(b.phases[0].flows.map((f) => f.id));
  const ids = a.phases[0].flows.map((f) => f.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("fenced ```accept blocks are not mistaken for headings", () => {
  const md = "## 段\n```\n# 这是代码注释不是标题\n```\n正文。\n";
  const m = parseMethodPlan(md);
  expect(m.phases.map((p) => p.title)).toEqual(["段"]);
});

test("explicit acceptance in a flow's section is captured at parse time (tier-1 wins)", () => {
  const md = "## 后端\n\n### 建表\n做 schema。\n\n```accept\nnpx vitest run schema\n```\n\n### 接口\n做 route。\n验收: ls route.ts\n";
  const m = parseMethodPlan(md);
  expect(m.phases[0].flows[0].acceptanceCmd).toBe("npx vitest run schema");
  expect(m.phases[0].flows[1].acceptanceCmd).toBe("ls route.ts");
});
