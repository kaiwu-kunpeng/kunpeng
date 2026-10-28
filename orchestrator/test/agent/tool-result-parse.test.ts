import { describe, it, expect } from "vitest";
import { parseClaudeStreamLine } from "../../src/agent/cli-stream-parse.js";

describe("tool_use id + tool_result 解析(实测 claude 流格式)", () => {
  it("tool_use content_block_start → tool 名 + toolId", () => {
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_012", name: "Bash", input: {} } } });
    expect(parseClaudeStreamLine(line)).toEqual({ tool: "Bash", toolId: "toolu_012" });
  });

  it("tool_result(user 消息)→ toolResult{id, ok=!is_error}", () => {
    const ok = JSON.stringify({ type: "user", message: { role: "user", content: [{ tool_use_id: "toolu_012", type: "tool_result", content: "文件A\n文件B", is_error: false }] } });
    expect(parseClaudeStreamLine(ok)).toEqual({ toolResult: { id: "toolu_012", ok: true } });
    const err = JSON.stringify({ type: "user", message: { role: "user", content: [{ tool_use_id: "toolu_012", type: "tool_result", content: "报错了", is_error: true }] } });
    expect(parseClaudeStreamLine(err)).toEqual({ toolResult: { id: "toolu_012", ok: false } });
  });

  it("is_error 缺省视为成功(ok=true)", () => {
    const line = JSON.stringify({ type: "user", message: { content: [{ tool_use_id: "t1", type: "tool_result", content: "ok" }] } });
    expect(parseClaudeStreamLine(line)).toEqual({ toolResult: { id: "t1", ok: true } });
  });

  it("user 消息但无 tool_result → null", () => {
    const line = JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "普通" }] } });
    expect(parseClaudeStreamLine(line)).toBeNull();
  });

  it("tool_use 无 id → 仅 tool 名(向后兼容)", () => {
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", name: "X" } } });
    expect(parseClaudeStreamLine(line)).toEqual({ tool: "X" });
  });
});