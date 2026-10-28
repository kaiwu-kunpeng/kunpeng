import { describe, expect, it } from "vitest";
import { parseCodexStreamLine } from "../../src/agent/cli-stream-parse.js";
import { parseCodexJsonl } from "../../src/agent/codex-json-parse.js";
import { effectiveBilledTokens } from "../../src/runtime/billed-tokens.js";

// codex 0.153 --json 的 turn.completed 真实形状(OpenAI 口径):input_tokens 含 cached_input_tokens。
const REAL_TURN = { type: "turn.completed", usage: { input_tokens: 20458, cached_input_tokens: 1408, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } };

describe("codex 缓存 token 口径(作者锁定)", () => {
  it("对话流:cached_input_tokens 拆成 cacheRead,input 只留未命中部分", () => {
    const r = parseCodexStreamLine(JSON.stringify(REAL_TURN));
    expect(r?.usage?.input).toBe(20458 - 1408);
    expect(r?.usage?.cacheRead).toBe(1408);
    expect(r?.usage?.cacheCreate).toBe(0);
    expect(r?.usage?.output).toBe(5);
  });
  it("对话流:cache_write_input_tokens → cacheCreate;cached 大于 input 时 input 钳到 0", () => {
    const r = parseCodexStreamLine(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 150, cache_write_input_tokens: 30, output_tokens: 1 } }));
    expect(r?.usage).toEqual({ input: 0, output: 1, cacheCreate: 30, cacheRead: 150 });
  });
  it("对话流:claude 风格字段(cache_read/cache_creation)原样透传,不做减法(P2 契约不变)", () => {
    const r = parseCodexStreamLine(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000, cache_creation_input_tokens: 40 } }));
    expect(r?.usage).toEqual({ input: 100, output: 20, cacheCreate: 40, cacheRead: 5000 });
  });
  it("对话流:只有 output_tokens 时其它字段缺省(既有测试形状不变)", () => {
    expect(parseCodexStreamLine(JSON.stringify({ type: "turn.completed", usage: { output_tokens: 321 } }))).toEqual({ usage: { output: 321 } });
  });
  it("loop 侧 parseCodexJsonl:tokens = effectiveBilledTokens(四象限),不再只数 output", () => {
    const line = JSON.stringify(REAL_TURN);
    const expected = effectiveBilledTokens({ input: 20458 - 1408, output: 5, cacheCreate: 0, cacheRead: 1408 });
    expect(expected).toBeGreaterThan(5);
    expect(parseCodexJsonl(line)).toEqual({ text: "", tokens: expected });
    expect(parseCodexJsonl([line, line].join("\n")).tokens).toBe(expected * 2);
  });
});