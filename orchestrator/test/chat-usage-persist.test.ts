import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ConversationStore } from "../src/chat/conversation-store.js";
import { persistChatRound } from "../src/server/workspace-endpoints.js";
import { clientScript } from "../src/server/ui/client.js";

function makeStore(): ConversationStore {
  let n = 0;
  return new ConversationStore(mkdtempSync(join(tmpdir(), "kp-usage-")), {
    now: () => 1000 + n,
    id: () => `conv-test-${n++}`,
  });
}

describe("对话用量入库与重放", () => {
  test("persistChatRound 带 usage → assistant 轮落盘含 usage,读回一致", async () => {
    const store = makeStore();
    const conv = await store.create("u1", { model: "claude-opus-4-8" });
    await persistChatRound(store, "u1", conv.id, {
      userText: "问",
      replyText: "答",
      usage: { input: 7277, output: 42, model: "claude-opus-4-8" },
      at: 1234,
    });
    const back = await store.get("u1", conv.id);
    const asst = back!.turns.find((t) => t.role === "assistant")!;
    expect(asst.usage).toEqual({ input: 7277, output: 42, model: "claude-opus-4-8" });
  });

  test("不带 usage 照常入库(向后兼容,老轮次无该字段)", async () => {
    const store = makeStore();
    const conv = await store.create("u1", { model: "m" });
    await persistChatRound(store, "u1", conv.id, { userText: "a", replyText: "b" });
    const back = await store.get("u1", conv.id);
    expect(back!.turns[1].usage).toBeUndefined();
  });

  test("重放渲染:client 脚本按 in/out 格式还原用量行并刷新计数器", () => {
    const body = String(clientScript);
    expect(body).toContain("turn.usage");
    expect(body).toContain("kp-ev-usage");
    expect(body).toMatch(/in ' \+ \(turn\.usage\.input \|\| 0\) \+ ' \/ out ' \+ \(turn\.usage\.output \|\| 0\)/);
    expect(body).toMatch(/updateTokens\(log, win\.querySelector\("\.kp-win-toks"\)\)/);
  });

  test("SPA 脚本语法有效且既有守卫未动", () => {
    const body = String(clientScript).replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");
    expect(() => new Function(body)).not.toThrow();
    expect(body).toContain("function nearBottom");
    expect(body).toContain("function localfsActionLinks");
    expect(body).toContain("openingConvs");
  });
});