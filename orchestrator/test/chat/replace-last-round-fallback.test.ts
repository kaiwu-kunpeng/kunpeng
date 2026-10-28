import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ConversationStore } from "../../src/chat/conversation-store.js";
import { persistChatRound } from "../../src/server/chat-persistence.js";

const USER = "u1";

async function freshStore(): Promise<{ store: ConversationStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "kp-replace-fallback-"));
  let seq = 0;
  const store = new ConversationStore(dir, { now: () => 1_000 + (seq += 1), id: () => `conv-${seq}` });
  return { store, dir };
}

describe("replaceLastRound 落空时回退追加", () => {
  it("空会话上 replaceLast=true 仍把两条 turn 落库", async () => {
    const { store, dir } = await freshStore();
    const conv = await store.create(USER, { model: "claude-opus-5" });
    await persistChatRound(store, USER, conv.id, { userText: "问题A", replyText: "回答A" }, true);
    const got = await store.get(USER, conv.id);
    const texts = (got?.turns ?? []).map((t) => t.text);
    expect(texts).toContain("问题A");
    expect(texts).toContain("回答A");
    await rm(dir, { recursive: true, force: true });
  });

  it("已有轮次时 replaceLast=true 是替换，轮数不增加", async () => {
    const { store, dir } = await freshStore();
    const conv = await store.create(USER, { model: "claude-opus-5" });
    await persistChatRound(store, USER, conv.id, { userText: "问题A", replyText: "回答A" }, false);
    const before = (await store.get(USER, conv.id))?.turns.length ?? 0;
    await persistChatRound(store, USER, conv.id, { userText: "问题A", replyText: "回答B" }, true);
    const after = await store.get(USER, conv.id);
    expect(after?.turns.length).toBe(before);
    expect((after?.turns ?? []).map((t) => t.text)).toContain("回答B");
    await rm(dir, { recursive: true, force: true });
  });

  it("replaceLast=false 时照旧追加", async () => {
    const { store, dir } = await freshStore();
    const conv = await store.create(USER, { model: "claude-opus-5" });
    await persistChatRound(store, USER, conv.id, { userText: "Q1", replyText: "R1" }, false);
    await persistChatRound(store, USER, conv.id, { userText: "Q2", replyText: "R2" }, false);
    const got = await store.get(USER, conv.id);
    const texts = (got?.turns ?? []).map((t) => t.text);
    expect(texts).toContain("R1");
    expect(texts).toContain("R2");
    await rm(dir, { recursive: true, force: true });
  });
});