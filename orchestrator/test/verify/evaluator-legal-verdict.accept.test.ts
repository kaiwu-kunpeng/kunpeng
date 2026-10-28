import { describe, expect, it } from "vitest";
import { parseEvaluatorVerdict } from "../../src/verify/evaluator.js";

describe("片段只采信合法判词", () => {
  it("判词后附不含 verdict 的对象 → 仍取判词", () => {
    expect(parseEvaluatorVerdict('{"verdict":"pass","reason":"一致"}\n统计：{"files":2,"tests":5}')).toEqual({ verdict: "pass", reason: "一致" });
  });

  it("判词后附非法 verdict 草稿 → 仍取判词", () => {
    expect(parseEvaluatorVerdict('{"verdict":"fail","reason":"缺覆盖"}\n{"verdict":"approve","reason":"草稿"}')).toEqual({ verdict: "fail", reason: "缺覆盖" });
  });

  it("前有无关对象、后有坏 JSON → 取中间的判词", () => {
    expect(parseEvaluatorVerdict('读到 {"a":1}\n{"verdict":"inconclusive","reason":"diff 截断"}\n{bad json}')).toEqual({ verdict: "inconclusive", reason: "diff 截断" });
  });

  it("多个合法判词取最后一个", () => {
    expect(parseEvaluatorVerdict('{"verdict":"pass","reason":"初"}\n{"x":1}\n{"verdict":"fail","reason":"终"}\n{"y":2}')).toEqual({ verdict: "fail", reason: "终" });
  });

  it("整段是无 verdict 对象 → 不可解析", () => {
    expect(parseEvaluatorVerdict('{"files":2}')).toEqual({ verdict: "inconclusive", reason: "评估器输出不可解析" });
  });

  it("只有非法 verdict → 不可解析", () => {
    expect(parseEvaluatorVerdict('{"verdict":"PASS","reason":"x"} {"verdict":"ok"}').reason).toBe("评估器输出不可解析");
  });
});