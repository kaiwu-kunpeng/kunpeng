import { expect, test } from "vitest";
import { newFailures } from "../src/verify/gate.js";

test("同一通过测试、仅耗时不同(524ms vs 536ms)→ 不算新失败", () => {
  const base = " ✓ DevCycle emits rolled-back done event when verification fails 536ms";
  const after = " ✓ DevCycle emits rolled-back done event when verification fails 524ms";
  expect(newFailures(base, after)).toEqual([]);
});

test("通过行即便名字含 fail/error 也不算失败", () => {
  expect(newFailures("", "✓ handles error path gracefully 12ms")).toEqual([]);
  expect(newFailures("", "PASS  test that fails on bad input")).toEqual([]);
});

test("after 里真·新失败(基线没有)被抓出", () => {
  const got = newFailures("✓ a 1ms", "✓ a 2ms\n✗ b should work 3ms\nAssertionError: expected 1 to be 2");
  expect(got.some((l) => /b should work/.test(l))).toBe(true);
  expect(got.some((l) => /AssertionError/.test(l))).toBe(true);
});

test("基线已有的失败不算新(差分)", () => {
  const base = "✗ flaky already broken 5ms";
  const after = "✗ flaky already broken 9ms";
  expect(newFailures(base, after)).toEqual([]);
});

test("真失败与计时无关地被识别(剥离计时后仍判失败)", () => {
  expect(newFailures("✓ ok 1ms", "✗ new boom 1ms").length).toBeGreaterThan(0);
});

test("app 日志行(集成测试跑真 plan 吐的 [warn]/[结果],含每跑不同的 planId)不算新失败", () => {
  const base =
    '[warn] flow rolled-back (verification failed) · flowId=p0-0-0 planId=plan-aaaaaa-1111 phase=0 reason=\n' +
    '[warn] phase failed — stopping plan · planId=plan-aaaaaa-1111 phase=0 failed=["p0-0-0"]';
  const after =
    '[warn] flow rolled-back (verification failed) · flowId=p0-0-0 planId=plan-bbbbbb-2222 phase=0 reason=\n' +
    '[warn] phase failed — stopping plan · planId=plan-bbbbbb-2222 phase=0 failed=["p0-0-0"]';
  expect(newFailures(base, after)).toEqual([]);
});

test("即便 planId 不同,真·检查失败(error TS / ✗)仍被抓出——日志过滤不吞真失败", () => {
  const base = '[warn] some plan-aaaaaa-1111 noise';
  const after = '[warn] some plan-bbbbbb-2222 noise\nsrc/x.ts(3,5): error TS2304: Cannot find name foo\n✗ real new test fails';
  const got = newFailures(base, after);
  expect(got.some((l) => /TS2304/.test(l))).toBe(true);
  expect(got.some((l) => /real new test fails/.test(l))).toBe(true);
});

test("ANSI 色码的 ✓ 通过行(测试名含 fail 字样、慢测颜色 32m↔33m 漂移)不算新失败——2026-07-05 击穿实锤", () => {
  const g="\u001b[32m\u2713\u001b[39m";
  const y="\u001b[33m\u001b[2m\u2713\u001b[22m\u001b[39m";
  const base = g + " test/server/auth-failclosed.test.ts (12 tests) 120ms\n" + g + " DevCycle emits rolled-back done event when verification fails 80ms";
  const after = y + " test/server/auth-failclosed.test.ts (12 tests) 950ms\n" + y + " DevCycle emits rolled-back done event when verification fails 700ms";
  expect(newFailures(base, after)).toEqual([]);
  expect(newFailures("", after)).toEqual([]);
});

test("ANSI 色码的真失败(✗/FAIL)剥色后仍被抓出——剥 ANSI 不吞真失败", () => {
  const after = "\u001b[31m\u2717\u001b[39m real broken test 5ms\n\u001b[31mFAIL\u001b[39m test/x.test.ts";
  const got = newFailures("", after);
  expect(got.some((l) => /real broken test/.test(l))).toBe(true);
  expect(got.some((l) => /FAIL test\/x\.test\.ts/.test(l))).toBe(true);
});
