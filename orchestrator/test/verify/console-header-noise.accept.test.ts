import { describe, expect, it } from "vitest";
import { newFailures } from "../../src/verify/gate.js";

const BASE = [" ✓ test/a.test.ts > ok", " Test Files  1 passed (1)"].join("\n");

describe("newFailures 忽略 vitest 控制台标题行", () => {
  it("stderr 标题行（测试名含 fail）不算新失败", () => {
    const after = `${BASE}\nstderr | test/runtime/sensitive-park.accept.test.ts > mergeAndClearGate 停车场 > 敏感判定抛错 → fail-closed 不合并`;
    expect(newFailures(BASE, after)).toEqual([]);
  });

  it("stdout 标题行（测试名含 error）不算新失败", () => {
    const after = `${BASE}\nstdout | test/x.test.ts > reports error budget`;
    expect(newFailures(BASE, after)).toEqual([]);
  });

  it("真失败行照旧计入", () => {
    const after = [
      BASE,
      " FAIL  test/x.test.ts > breaks",
      " × test/x.test.ts > breaks",
      "AssertionError: expected 1 to be 2",
      "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    ].join("\n");
    const out = newFailures(BASE, after);
    expect(out).toHaveLength(4);
    expect(out.some((l) => l.startsWith("FAIL"))).toBe(true);
    expect(out.some((l) => l.includes("TS2322"))).toBe(true);
  });

  it("标题下的内容行照旧按原规则判定", () => {
    const after = `${BASE}\nstderr | test/x.test.ts > logs\nError: real problem`;
    expect(newFailures(BASE, after)).toEqual(["Error: real problem"]);
  });
});