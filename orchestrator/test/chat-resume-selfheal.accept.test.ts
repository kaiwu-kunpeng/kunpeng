import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../src/chat/conversation-store.js";

describe("续跑失效自愈(作者验收)", () => {
  it("clearCliSessionId 清除已存的 session id", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-heal-"));
    let n = 0;
    const store = new ConversationStore(base, { now: () => ++n, id: () => `conv-${++n}` });
    const conv = await store.create("u1", { model: "claude-opus-4-8" });
    await store.setCliSessionId("u1", conv.id, "sess-dead");
    await store.clearCliSessionId("u1", conv.id);
    const got = await store.get("u1", conv.id);
    expect(got?.cliSessionId).toBeUndefined();
  });

  it("会话不存在/无字段时静默不抛", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-heal2-"));
    let n = 0;
    const store = new ConversationStore(base, { now: () => ++n, id: () => `conv-${++n}` });
    await expect(store.clearCliSessionId("u1", "no-such")).resolves.toBeUndefined();
    const conv = await store.create("u1", { model: "claude-opus-4-8" });
    await expect(store.clearCliSessionId("u1", conv.id)).resolves.toBeUndefined();
  });
});