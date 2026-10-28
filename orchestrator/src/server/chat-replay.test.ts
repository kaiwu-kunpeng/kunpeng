import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { ConversationStore } from "../chat/conversation-store.js";
import type { ChatTurn } from "../chat/conversation-store.js";
import {
  buildReplayTurns,
  persistChatRound,
  resolveConversationId,
} from "./workspace-endpoints.js";

function freshStore() {
  const base = mkdtempSync(join(tmpdir(), "kp-resolve-"));
  let n = 0;
  return new ConversationStore(base, { now: () => ++n, id: () => `conv-${++n}` });
}

// buildReplayTurns(conv) -> ChatTurn[] 完整历史（不再 slice(-20)）
// persistChatRound(store, username, convId, {userText, replyText, web, at}) -> Promise<void>

describe("chat full replay + persistence", () => {
  test("buildReplayTurns returns ALL turns, not last 20", () => {
    const turns = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `t${i}`,
    })) as ChatTurn[];
    expect(buildReplayTurns({ turns })).toHaveLength(25);
  });

  test("persistChatRound appends both turns and marks web on assistant", async () => {
    const base = mkdtempSync(join(tmpdir(), "kp-replay-"));
    let n = 0;
    const store = new ConversationStore(base, { now: () => ++n, id: () => `conv-${++n}` });
    const c = await store.create("alice", { model: "m" });
    await persistChatRound(store, "alice", c.id, {
      userText: "查天气",
      replyText: "晴",
      web: true,
      at: 1,
    });
    const got = await store.get("alice", c.id);
    expect(got?.turns).toHaveLength(2);
    expect(got?.turns[0]).toMatchObject({ role: "user", text: "查天气" });
    expect(got?.turns[1]).toMatchObject({ role: "assistant", text: "晴", web: true });
  });
});

describe("resolveConversationId (backward-compat + isolation)", () => {
  test("existing conv owned by user is reused", async () => {
    const store = freshStore();
    const c = await store.create("alice", { model: "m" });
    const id = await resolveConversationId(store, "alice", { conv: c.id, model: "m" });
    expect(id).toBe(c.id);
  });

  test("conv not owned by the user creates a fresh conversation (no cross-account)", async () => {
    const store = freshStore();
    const c = await store.create("alice", { model: "m" });
    const id = await resolveConversationId(store, "bob", { conv: c.id, model: "m" });
    expect(id).not.toBe(c.id);
    expect(await store.get("bob", id)).not.toBeNull();
    expect(await store.get("alice", id)).toBeNull();
  });

  test("same (user, session) maps to the same conversation across calls", async () => {
    const store = freshStore();
    const a = await resolveConversationId(store, "alice", { session: "win-A", model: "m" });
    const b = await resolveConversationId(store, "alice", { session: "win-A", model: "m" });
    expect(a).toBe(b);
  });

  test("different sessions map to different conversations", async () => {
    const store = freshStore();
    const a = await resolveConversationId(store, "alice", { session: "win-B", model: "m" });
    const b = await resolveConversationId(store, "alice", { session: "win-C", model: "m" });
    expect(a).not.toBe(b);
  });
});
