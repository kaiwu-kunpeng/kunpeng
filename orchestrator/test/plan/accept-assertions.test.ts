import { describe, expect, it } from "vitest";
import {
  judgeAssertions,
  parseAcceptAssertions,
  summarizeAssertions,
  type AcceptAssertion,
} from "../../src/plan/accept-assertions.js";

// 今天真实用过的一条 accept 命令
const REAL =
  'cd orchestrator && test -f test/objects/stage-report.test.ts && grep -q "buildStageCostRows" src/objects/stage-report.ts && grep -q "isAggregateFlowId" src/objects/flow-metrics.ts && ! grep -q "console" src/objects/stage-report.ts && npx --no-install tsc --noEmit && npx --no-install vitest run stage-report';

describe("parseAcceptAssertions", () => {
  it("从真实 accept 命令里提取全部 grep 断言", () => {
    const list = parseAcceptAssertions(REAL);
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({
      pattern: "buildStageCostRows",
      file: "src/objects/stage-report.ts",
      negated: false,
    });
    expect(list[2]).toEqual({
      pattern: "console",
      file: "src/objects/stage-report.ts",
      negated: true,
    });
  });

  it("忽略 test -f / npx / cd 等非 grep 片段", () => {
    const list = parseAcceptAssertions("cd x && test -f a.ts && npx tsc --noEmit");
    expect(list).toEqual([]);
  });

  it("单引号、双引号、无引号都能提取且剥掉引号", () => {
    const list = parseAcceptAssertions(
      `grep -q 'typeof flowId' a.ts && grep -q "flowId: unknown" b.ts && grep -q plainWord c.ts`,
    );
    expect(list.map((a) => a.pattern)).toEqual(["typeof flowId", "flowId: unknown", "plainWord"]);
    expect(list.map((a) => a.file)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("识别 -qE 与 -qi 等 flag 组合", () => {
    const list = parseAcceptAssertions('grep -qE "a|b" x.ts && ! grep -qi "Foo" y.ts');
    expect(list).toHaveLength(2);
    expect(list[0].pattern).toBe("a|b");
    expect(list[1].negated).toBe(true);
    expect(list[1].pattern).toBe("Foo");
  });

  it("空输入返回空数组且不抛", () => {
    expect(parseAcceptAssertions("")).toEqual([]);
  });
});

describe("judgeAssertions", () => {
  const a = (pattern: string, negated: boolean): AcceptAssertion => ({
    pattern,
    file: "f.ts",
    negated,
  });

  it("正向断言在当前已命中 → 空断言", () => {
    const [v] = judgeAssertions([a("已存在", false)], () => true);
    expect(v.currentlyHolds).toBe(true);
    expect(v.vacuous).toBe(true);
  });

  it("正向断言在当前未命中 → 有效", () => {
    const [v] = judgeAssertions([a("将要新增", false)], () => false);
    expect(v.vacuous).toBe(false);
  });

  it("负向断言在当前未命中 → 空断言", () => {
    const [v] = judgeAssertions([a("本来就没有", true)], () => false);
    expect(v.vacuous).toBe(true);
  });

  it("负向断言在当前已命中 → 有效", () => {
    const [v] = judgeAssertions([a("该被删掉的", true)], () => true);
    expect(v.vacuous).toBe(false);
  });

  it("按每条断言分别调用 holds", () => {
    const seen: string[] = [];
    judgeAssertions([a("p1", false), a("p2", true)], (x) => {
      seen.push(x.pattern);
      return false;
    });
    expect(seen).toEqual(["p1", "p2"]);
  });
});

describe("summarizeAssertions", () => {
  it("三个计数自洽", () => {
    const verdicts = judgeAssertions(
      [
        { pattern: "a", file: "f", negated: false },
        { pattern: "b", file: "f", negated: false },
        { pattern: "c", file: "f", negated: true },
      ],
      (x) => x.pattern === "a",
    );
    const s = summarizeAssertions(verdicts);
    expect(s.total).toBe(3);
    expect(s.vacuous + s.effective).toBe(s.total);
    expect(s.vacuous).toBe(2);
    expect(s.effective).toBe(1);
  });

  it("空输入返回全零", () => {
    expect(summarizeAssertions([])).toEqual({ total: 0, vacuous: 0, effective: 0 });
  });
});