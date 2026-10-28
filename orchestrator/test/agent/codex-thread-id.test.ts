import { describe, expect, it } from "vitest";
import { parseClaudeStreamLine, parseCodexStreamLine, parseCodexThreadId } from "../../src/agent/cli-stream-parse.js";
import { CliRunner, type Backend } from "../../src/agent/cli-runner.js";
import type { StreamDelta } from "../../src/agent/cli-stream-parse.js";

describe("会话 id 解析（作者锁定）", () => {
  it("parseCodexThreadId 只认 thread.started；parseCodexStreamLine 对它仍返回 null（既有语义）", () => {
    const line = JSON.stringify({ type: "thread.started", thread_id: "01a0aac7-e5ed-7af3-a1a9-a09389ee0446" });
    expect(parseCodexThreadId(line)).toBe("01a0aac7-e5ed-7af3-a1a9-a09389ee0446");
    expect(parseCodexThreadId(JSON.stringify({ type: "thread.started" }))).toBeUndefined();
    expect(parseCodexThreadId(JSON.stringify({ type: "turn.started" }))).toBeUndefined();
    expect(parseCodexThreadId("not json")).toBeUndefined();
    expect(parseCodexStreamLine(line)).toBeNull();
    expect(parseCodexStreamLine("not json")).toEqual({ text: "not json" });
  });

  it("claude 解析仍带 session_id", () => {
    const d = parseClaudeStreamLine(JSON.stringify({ type: "system", subtype: "init", session_id: "s-1" }));
    expect(d?.sessionId).toBe("s-1");
  });

  it("runStreaming 在 codex 流里把 thread id 作为 sessionId delta 发出", async () => {
    const deltas: StreamDelta[] = [];
    const runner = new CliRunner({
      backend: "codex",
      availableBackends: new Set<Backend>(["codex"]),
      streamExec: async (_file, _args, _cwd, onLine) => {
        onLine(JSON.stringify({ type: "thread.started", thread_id: "t-1" }));
        onLine(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hi" } }));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    const r = await runner.runStreaming({ stage: "implement", system: "", input: "x", tools: [], cwd: "/tmp" }, (d) => { deltas.push(d); });
    expect(deltas.some((d) => d.sessionId === "t-1")).toBe(true);
    expect(r.backend).toBe("codex");
  });
});