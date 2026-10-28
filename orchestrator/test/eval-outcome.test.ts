import { expect, test } from "vitest";
import { classifyEvalOutcome } from "../src/evolution/eval-outcome.js";

test("成功→tested 且 attached", () => {
  const o = classifyEvalOutcome({ ok: true });
  expect(o.evidenceState).toBe("tested");
  expect(o.attached).toBe(true);
});

test("Error 失败→downgraded、不 attach、reason 取 message", () => {
  const o = classifyEvalOutcome({ ok: false, error: new Error("boom") });
  expect(o.evidenceState).toBe("downgraded");
  expect(o.attached).toBe(false);
  expect(o.reason ?? "").toContain("boom");
});

test("非 Error 失败(字符串/undefined/null/number)→仍 downgraded 且 reason 非空，绝不抛错", () => {
  for (const err of ["str-err", undefined, 42, null]) {
    const o = classifyEvalOutcome({ ok: false, error: err });
    expect(o.evidenceState).toBe("downgraded");
    expect(o.attached).toBe(false);
    expect((o.reason ?? "").length > 0).toBe(true);
  }
});