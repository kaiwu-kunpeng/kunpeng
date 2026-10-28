import { describe, expect, it } from "vitest";
import { parseEvaluatorVerdict } from "../../src/verify/evaluator.js";
import { classifySensitiveFiles } from "../../src/runtime/sensitive-paths.js";

describe("parseEvaluatorVerdict 容忍 reason 里的花括号", () => {
  it("10-17 实测原文：reason 含 ${var} → pass", () => {
    const raw = '{"verdict":"pass","reason":"全部变量路径参数化且全角前用 ${var}，28 项全绿。"}';
    const v = parseEvaluatorVerdict(raw);
    expect(v.verdict).toBe("pass");
    expect(v.reason).toContain("${var}");
  });

  it("reason 含不成对花括号与转义引号", () => {
    const raw = '{"verdict":"fail","reason":"缺少收尾 } 且 \\"accept\\" 未闭合 {"}';
    const v = parseEvaluatorVerdict(raw);
    expect(v.verdict).toBe("fail");
    expect(v.reason).toContain("\"accept\"");
  });

  it("前后有说明文字", () => {
    const raw = '结论如下：\n{"verdict":"pass","reason":"见 {a:1} 片段"}\n以上。';
    expect(parseEvaluatorVerdict(raw)).toEqual({ verdict: "pass", reason: "见 {a:1} 片段" });
  });

  it("包在 json 围栏里", () => {
    const raw = '```json\n{"verdict":"pass","reason":"围栏内 ${x}"}\n```';
    expect(parseEvaluatorVerdict(raw)).toEqual({ verdict: "pass", reason: "围栏内 ${x}" });
  });

  it("多个判词取最后一个合法的", () => {
    const raw = '{"verdict":"pass","reason":"初判 {x}"}\n复核后：{"verdict":"fail","reason":"终判 ${y}"}';
    expect(parseEvaluatorVerdict(raw)).toEqual({ verdict: "fail", reason: "终判 ${y}" });
  });

  it("verdict 非法值不被采信", () => {
    expect(parseEvaluatorVerdict('{"verdict":"maybe","reason":"x"}')).toEqual({ verdict: "inconclusive", reason: "评估器输出不可解析" });
  });

  it("空文本与纯文字", () => {
    expect(parseEvaluatorVerdict("   ").reason).toBe("评估器无输出");
    expect(parseEvaluatorVerdict("我觉得通过了").reason).toBe("评估器输出不可解析");
  });
});

describe("评估器源码判敏感", () => {
  it("src/verify/evaluator.ts", () => {
    expect(classifySensitiveFiles(["orchestrator/src/verify/evaluator.ts"]).sensitive).toBe(true);
    expect(classifySensitiveFiles(["orchestrator/src/verify/evaluator-notes.ts"]).sensitive).toBe(false);
  });
});