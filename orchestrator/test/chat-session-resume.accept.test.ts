import { describe, expect, it } from "vitest";
import { parseClaudeStreamLine } from "../src/agent/cli-stream-parse.js";

describe("claude init 帧捕获 session_id(作者验收)", () => {
  it("init 帧返回 sessionId", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", session_id: "sess-abc123", model: "claude-opus-4-8" });
    const d = parseClaudeStreamLine(line);
    expect(d?.sessionId).toBe("sess-abc123");
  });

  it("无 session_id 的 system 帧不误报", () => {
    const d = parseClaudeStreamLine(JSON.stringify({ type: "system", subtype: "init" }));
    expect(d?.sessionId).toBeUndefined();
  });

  it("普通文本帧行为不变", () => {
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } });
    const d = parseClaudeStreamLine(line);
    expect(d?.sessionId).toBeUndefined();
  });
});