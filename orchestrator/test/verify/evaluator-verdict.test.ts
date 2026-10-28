import { expect, test } from "vitest";
import { buildEvaluatorInput, EVALUATOR_SYSTEM, parseEvaluatorVerdict } from "../../src/verify/evaluator.js";

test("评估器提示词限定只读、只看 diff 与测试输出、三值 JSON 判定", () => {
  expect(EVALUATOR_SYSTEM).toContain("只读");
  expect(EVALUATOR_SYSTEM).toContain("不要修改任何文件");
  expect(EVALUATOR_SYSTEM).toContain("pass|fail|inconclusive");
  expect(EVALUATOR_SYSTEM).toContain("不确定");
});

test("解析三值判定：pass/fail 取最后一个 JSON 对象；inconclusive 与不可解析都落 inconclusive", () => {
  expect(parseEvaluatorVerdict('{"verdict":"pass","reason":"diff 与验收一致"}')).toEqual({ verdict: "pass", reason: "diff 与验收一致" });
  const fence = "`".repeat(3);
  expect(parseEvaluatorVerdict(`思考过程……\n${fence}json\n{"verdict":"fail","reason":"少了 tsc 覆盖"}\n${fence}`)).toEqual({ verdict: "fail", reason: "少了 tsc 覆盖" });
  expect(parseEvaluatorVerdict('{"verdict":"pass","reason":"x"}\n修正：{"verdict":"fail","reason":"y"}')).toEqual({ verdict: "fail", reason: "y" });
  expect(parseEvaluatorVerdict('{"verdict":"inconclusive","reason":"diff 被截断"}')).toEqual({ verdict: "inconclusive", reason: "diff 被截断" });
  expect(parseEvaluatorVerdict('{"verdict":"approve","reason":"x"}').verdict).toBe("inconclusive");
  expect(parseEvaluatorVerdict("看起来没问题，pass").verdict).toBe("inconclusive");
  expect(parseEvaluatorVerdict("")).toEqual({ verdict: "inconclusive", reason: "评估器无输出" });
  expect(parseEvaluatorVerdict("blah").reason).toBe("评估器输出不可解析");
});

test("reason 裁到 400 字符、去多余空白；缺 reason 时给默认文案", () => {
  const long = "a".repeat(1000);
  const parsed = parseEvaluatorVerdict(JSON.stringify({ verdict: "fail", reason: `  x\n\n${long}` }));
  expect(parsed.verdict).toBe("fail");
  expect(parsed.reason.length).toBe(400);
  expect(parsed.reason.startsWith("x a")).toBe(true);
  expect(parseEvaluatorVerdict('{"verdict":"pass"}')).toEqual({ verdict: "pass", reason: "(评估器未给理由)" });
});

test("评估器输入四段齐全，diff 与验收输出各自按 maxChars 截断并标注", () => {
  const input = buildEvaluatorInput({
    requirement: "把 a 改成 b",
    spec: "## 验收\n- a→b",
    diff: "d".repeat(50),
    acceptOutput: "o".repeat(50),
    maxChars: 20,
  });
  expect(input).toContain("# 需求\n把 a 改成 b");
  expect(input).toContain("# spec / 验收标准\n## 验收\n- a→b");
  expect(input).toContain("# 代码 diff\n" + "d".repeat(20) + "\n…（已截断，共 50 字符）");
  expect(input).toContain("# 验收命令输出\n" + "o".repeat(20) + "\n…（已截断，共 50 字符）");
  const short = buildEvaluatorInput({ requirement: "r", spec: "s", diff: "dd", acceptOutput: "oo" });
  expect(short).toBe("# 需求\nr\n\n# spec / 验收标准\ns\n\n# 代码 diff\ndd\n\n# 验收命令输出\noo");
});