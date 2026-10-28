import { describe, expect, it } from "vitest";
import { parseClaudeStreamLine, parseCodexStreamLine } from "../../src/agent/cli-stream-parse.js";

describe("parseClaudeStreamLine", () => {
  it("text_delta → text 增量", () => {
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } } });
    expect(parseClaudeStreamLine(line)).toEqual({ text: "Hello" });
  });
  it("thinking_delta → thinking 增量", () => {
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "嗯" } } });
    expect(parseClaudeStreamLine(line)).toEqual({ thinking: "嗯" });
  });
  it("result → usage(input/output) + final 全文", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", result: "最终全文", usage: { input_tokens: 6865, output_tokens: 15 }, modelUsage: { "claude-opus-4-8": {} } });
    const d = parseClaudeStreamLine(line);
    expect(d?.usage?.input).toBe(6865);
    expect(d?.usage?.output).toBe(15);
    expect(d?.usage?.model).toBe("claude-opus-4-8");
    expect(d?.final).toBe("最终全文");
  });
  it("content_block_start(tool_use) → tool 名(大文件写入静默期的活动信号)", () => {
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_x", name: "mcp__localfs__localfs_write", input: {} } } });
    expect(parseClaudeStreamLine(line)).toEqual({ tool: "mcp__localfs__localfs_write", toolId: "toolu_x" });
  });
  it("content_block_start(text) → null,不产噪声帧", () => {
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
    expect(parseClaudeStreamLine(line)).toBeNull();
  });
  it("噪声/脏行 → null,绝不抛", () => {
    expect(parseClaudeStreamLine(JSON.stringify({ type: "system", subtype: "init", session_id: "sess-abc123" }))).toEqual({ sessionId: "sess-abc123" });
    expect(parseClaudeStreamLine(JSON.stringify({ type: "rate_limit_event" }))).toBeNull();
    expect(parseClaudeStreamLine("")).toBeNull();
    expect(parseClaudeStreamLine("not json {{{")).toBeNull();
    expect(parseClaudeStreamLine(JSON.stringify({ type: "stream_event", event: { type: "content_block_start" } }))).toBeNull();
  });
});

describe("parseCodexStreamLine", () => {
  it("普通行 → text(保留原文)", () => {
    expect(parseCodexStreamLine("正在实现…")).toEqual({ text: "正在实现…" });
  });
  it("tokens used 横幅 → null,避免和 turn.completed 双计", () => {
    expect(parseCodexStreamLine("tokens used 1,234")).toBeNull();
  });
  it("JSONL agent_message → text, turn.completed → usage.output", () => {
    expect(parseCodexStreamLine(JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "完成\nTESTCMD: npm test\n" },
    }))).toEqual({ text: "完成\nTESTCMD: npm test\n" });
    expect(parseCodexStreamLine(JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 10, output_tokens: 8 },
    }))).toEqual({ usage: { input: 10, output: 8 } });
  });
  it("JSONL 非 chat 事件 → null,避免把结构化事件刷进对话", () => {
    expect(parseCodexStreamLine(JSON.stringify({ type: "thread.started", thread_id: "t1" }))).toBeNull();
    expect(parseCodexStreamLine(JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "hidden" } }))).toBeNull();
  });
  it("空行 → null", () => {
    expect(parseCodexStreamLine("   ")).toBeNull();
  });
});
