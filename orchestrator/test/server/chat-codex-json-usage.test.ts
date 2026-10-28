import { describe, expect, test } from "vitest";
import { chatInvocation } from "../../src/server/chat-stream.js";
import { parseCodexStreamLine } from "../../src/agent/cli-stream-parse.js";
import { formatChatUsageLine, sumConversationUsd } from "../../src/server/chat-usage.js";

// codex 0.153 `exec --json` 真实事件序列(对话侧从未启用 --json,导致 30 轮 codex 对话 0 轮记过 usage)。
const JSONL = [
  { type: "thread.started", thread_id: "t1" },
  { type: "turn.started" },
  { type: "item.started", item: { id: "i0", type: "command_execution", command: "ls" } },
  { type: "item.completed", item: { id: "i0", type: "command_execution", command: "ls", exit_code: 0 } },
  { type: "item.completed", item: { id: "i1", type: "agent_message", text: "收到" } },
  { type: "turn.completed", usage: { input_tokens: 20458, cached_input_tokens: 1408, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } },
].map((e) => JSON.stringify(e));

describe("对话侧 codex 走 --json 以拿到 usage(作者锁定)", () => {
  test("codex / astra / 5.6 的对话调用都带且只带一个 --json,exec 仍是首参", () => {
    for (const model of ["codex", "gpt-6-astra", "gpt-5.6-sol"]) {
      const inv = chatInvocation(model, [], false);
      expect(inv.bin, model).toBe("codex");
      expect(inv.args[0], model).toBe("exec");
      expect(inv.args.filter((a) => a === "--json"), model).toHaveLength(1);
    }
    const plan = chatInvocation("codex", [], false, undefined, false, undefined, "plan");
    expect(plan.args).toContain("--json");
    expect(plan.args[plan.args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(chatInvocation("claude-opus-5", [], false).args).not.toContain("--json");
  });

  test("JSONL 事件经 parseCodexStreamLine:只有回复正文与 usage 进对话,其它事件静默", () => {
    const deltas = JSONL.map((l) => parseCodexStreamLine(l));
    expect(deltas.slice(0, 4).every((d) => d === null)).toBe(true);
    expect(deltas[4]).toEqual({ text: "收到" });
    expect(deltas[5]?.usage).toEqual({ input: 20458 - 1408, output: 5, cacheCreate: 0, cacheRead: 1408 });
  });

  test("usage 行按 codex=gpt-5.5 四向价:19050×5 + 1408×0.5 + 5×30 = $0.096104", () => {
    const usage = parseCodexStreamLine(JSONL[5]!)!.usage!;
    const line = formatChatUsageLine({ ...usage }, "codex");
    expect(line).toBe("in 19050 / out 5 (cache 读1408) · codex · $0.0961");
    expect(sumConversationUsd([{ usage: { ...usage, model: "codex" } }])).toBeCloseTo(0.096104, 9);
  });
});