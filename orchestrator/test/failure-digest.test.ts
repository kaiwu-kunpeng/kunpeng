import { expect, test } from "vitest";
import { summarizeFailures } from "../src/evolution/failure-digest.js";

test("totalFailures 只数失败记录(verified 不算)", () => {
  const d = summarizeFailures([
    { category: "scope", outcome: "verified", context: "ok" },
    { category: "scope", outcome: "rolled-back", context: "越界A" },
    { category: "wiring", outcome: "must-fix", context: "假绿B" },
  ]);
  expect(d.totalFailures).toBe(2);
});

test("聚类 count/examples(<=3)/降序/directions 仅 count>=2", () => {
  const d = summarizeFailures([
    { category: "scope", outcome: "rolled-back", context: "s1" },
    { category: "scope", outcome: "failed", context: "s2" },
    { category: "scope", outcome: "reject", context: "s3" },
    { category: "scope", outcome: "回滚", context: "s4" },
    { category: "wiring", outcome: "must-fix", context: "w1" },
  ]);
  expect(d.patterns[0].category).toBe("scope");
  expect(d.patterns[0].count).toBe(4);
  expect(d.patterns[0].examples).toEqual(["s1", "s2", "s3"]);
  expect(d.patterns[1].category).toBe("wiring");
  expect(d.directions.some((x) => x.includes("scope"))).toBe(true);
  expect(d.directions.some((x) => x.includes("wiring"))).toBe(false);
});

test("空输入", () => {
  expect(summarizeFailures([])).toEqual({ totalFailures: 0, patterns: [], directions: [] });
});
