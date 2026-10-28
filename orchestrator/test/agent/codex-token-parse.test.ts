import { describe, it, expect } from "vitest";
import { parseCodexStreamLine } from "../../src/agent/cli-stream-parse.js";

describe("parseCodexStreamLine — 修 token 虚高 / 正文被吞", () => {
  it("整行 token 横幅丢弃(不产 usage、不双计)", () => {
    expect(parseCodexStreamLine("tokens used 1,234")).toBeNull();
    expect(parseCodexStreamLine("  tokens used 500  ")).toBeNull();
  });

  it("正文里含 'tokens used N' 的句子作为正文保留(不被吞)", () => {
    const d = parseCodexStreamLine("这里说明总共 tokens used 1234 的情况");
    expect(d).toEqual({ text: "这里说明总共 tokens used 1234 的情况" });
  });

  it("usage 只从 turn.completed 取", () => {
    const d = parseCodexStreamLine(JSON.stringify({ type: "turn.completed", usage: { output_tokens: 321 } }));
    expect(d).toEqual({ usage: { output: 321 } });
  });

  it("item.completed agent_message → 文本", () => {
    const d = parseCodexStreamLine(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "答复内容" } }));
    expect(d).toEqual({ text: "答复内容" });
  });

  it("普通非 JSON 正文作为 text", () => {
    expect(parseCodexStreamLine("普通输出一行")).toEqual({ text: "普通输出一行" });
  });

  it("空行返回 null", () => {
    expect(parseCodexStreamLine("   ")).toBeNull();
  });
});