import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../src/chat/conversation-store.js";

describe("会话 fork(作者验收)", () => {
  it("fork 复制转录、剥离 cliSessionId、加前缀", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-fork-"));
    let n = 0;
    const store = new ConversationStore(base, { now: () => ++n, id: () => `conv-${++n}` });
    const conv = await store.create("u1", { model: "claude-opus-4-8" });
    await store.appendTurns("u1", conv.id, [{ role: "user", text: "你好" }, { role: "assistant", text: "在" }]);
    await store.setCliSessionId("u1", conv.id, "sess-orig");
    const forked = await store.fork("u1", conv.id);
    expect(forked).not.toBeNull();
    expect(forked!.id).not.toBe(conv.id);
    expect(forked!.turns.length).toBe(2);
    expect(forked!.turns[0].text).toBe("你好");
    expect(forked!.cliSessionId).toBeUndefined();
    expect(forked!.title.startsWith("[fork] ")).toBe(true);
    const orig = await store.get("u1", conv.id);
    expect(orig?.cliSessionId).toBe("sess-orig");
    const list = await store.list("u1");
    expect(list.length).toBe(2);
  });

  it("不存在的会话 fork 返回 null", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-fork2-"));
    let n = 0;
    const store = new ConversationStore(base, { now: () => ++n, id: () => `c-${++n}` });
    expect(await store.fork("u1", "no-such")).toBeNull();
  });
});