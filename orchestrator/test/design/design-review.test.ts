import { expect, test } from "vitest";

import {
  buildCritiquePrompt,
  buildFixPrompt,
  combineVerdict,
  parseCritique,
} from "../../src/design/design-review.js";

test("buildCritiquePrompt includes required review anchors and optional style anchor", () => {
  const prompt = buildCritiquePrompt({ anchor: "Swiss" });

  expect(prompt).toContain("对比度");
  expect(prompt).toContain("44");
  expect(prompt).toContain("#F4F1EA");
  expect(prompt).toContain("generic");
  expect(prompt).toContain("Swiss");
});

test("buildCritiquePrompt omits missing optional style anchor", () => {
  expect(buildCritiquePrompt({})).not.toContain("Swiss");
});

test("parseCritique extracts fenced JSON with noisy prefix and suffix", () => {
  expect(parseCritique('噪声前缀 ```json\n{"pass":true,"issues":[]}\n``` 尾部 banner')).toEqual({
    pass: true,
    issues: [],
  });
});

test("parseCritique fails closed for non JSON text", () => {
  const critique = parseCritique("完全不是json");

  expect(critique.pass).toBe(false);
  expect(critique.issues.length).toBeGreaterThan(0);
});

test("parseCritique preserves string issues", () => {
  const critique = parseCritique('{"pass":false,"issues":["按钮溢出","对比不足"]}');

  expect(critique.issues).toContain("按钮溢出");
  expect(critique.issues).toContain("对比不足");
});

test("combineVerdict passes only when deterministic and visual gates pass", () => {
  expect(combineVerdict(0, { pass: true, issues: [] })).toEqual({
    pass: true,
    mustFix: [],
  });
});

test("combineVerdict adds default aesthetic issue when lint p0 is positive", () => {
  const verdict = combineVerdict(1, { pass: true, issues: [] });

  expect(verdict.pass).toBe(false);
  expect(verdict.mustFix).toContain("三大默认审美命中");
});

test("combineVerdict carries critique issues when visual review fails", () => {
  const verdict = combineVerdict(0, { pass: false, issues: ["x"] });

  expect(verdict.pass).toBe(false);
  expect(verdict.mustFix).toContain("x");
});

test("buildFixPrompt appends mandatory fix list", () => {
  const prompt = buildFixPrompt("SYS", ["删重复", "修B"]);

  expect(prompt).toContain("SYS");
  expect(prompt).toContain("删重复");
  expect(prompt).toContain("修B");
  expect(prompt).toContain("必须");
  expect(prompt).toContain("删除");
  expect(prompt).toContain("彻底");
  expect(prompt).toContain("上一版");
});
