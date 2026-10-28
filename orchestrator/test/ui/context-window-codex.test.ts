import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { clientScript } from "../../src/server/ui/client.js";

/** 从 clientScript 抠出 kpCtxEstimate 真函数(brace 配对),独立 eval 后返回。 */
function kpCtxEstimate(): (usage: unknown) => { used: number; window: number; ratio: number } {
  const at = clientScript.indexOf("function kpCtxEstimate(");
  if (at < 0) throw new Error("clientScript 里找不到 kpCtxEstimate");
  let depth = 0; let started = false;
  for (let i = at; i < clientScript.length; i++) {
    if (clientScript[i] === "{") { depth++; started = true; }
    else if (clientScript[i] === "}" && --depth === 0 && started) {
      return new Function(`${clientScript.slice(at, i + 1)}; return kpCtxEstimate;`)() as never;
    }
  }
  throw new Error("kpCtxEstimate 括号不闭合");
}

// codex 0.153 models_cache.json:gpt-6-astra / gpt-5.5 / gpt-5.6-* 的 context_window 都是 272000。
describe("上下文水位条:codex / gpt 系列窗口按 272K 估算(作者锁定)", () => {
  const est = kpCtxEstimate();
  test("codex 与 gpt-* 模型窗口 272000", () => {
    for (const model of ["codex", "gpt-6-astra", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "GPT-6-Astra"]) {
      expect(est({ input: 1000, model }).window, model).toBe(272000);
    }
  });
  test("claude 系列窗口不变:opus 200K、[1m]/sonnet/fable 1M,未知 200K", () => {
    expect(est({ input: 1, model: "claude-opus-5" }).window).toBe(200000);
    expect(est({ input: 1, model: "claude-opus-4-8" }).window).toBe(200000);
    expect(est({ input: 1, model: "claude-opus-5[1m]" }).window).toBe(1000000);
    expect(est({ input: 1, model: "claude-sonnet-5" }).window).toBe(1000000);
    expect(est({ input: 1, model: "claude-fable-5-1" }).window).toBe(1000000);
    expect(est({ input: 1 }).window).toBe(200000);
    expect(est(undefined).window).toBe(200000);
  });
  test("codex 一轮 in 26595 + cache 读 4480 → used 31075,ratio 按 272K", () => {
    const r = est({ input: 26595, cacheRead: 4480, output: 27, model: "codex" });
    expect(r.used).toBe(31075);
    expect(r.ratio).toBeCloseTo(31075 / 272000, 9);
  });
  test("源码锚点:part01 含 272000 且 OpenAI 判定在 claude 判定之前", () => {
    const src = readFileSync(new URL("../../src/server/ui/client-parts/part01.ts", import.meta.url), "utf8");
    expect(src).toContain("272000");
    expect(src.indexOf("272000")).toBeLessThan(src.indexOf("1000000 : 200000"));
  });
});