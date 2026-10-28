import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../src/chat/conversation-store.js";
import { handleConversationAction } from "../src/server/conversation-endpoints.js";

function mkStore(base: string) {
  let n = 0;
  return new ConversationStore(base, { now: () => ++n, id: () => `c-${++n}` });
}

describe("归档管理(作者验收)", () => {
  it("purge 只删归档会话,活会话拒绝", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-purge-"));
    const store = mkStore(base);
    const conv = await store.create("u1", { model: "claude-opus-4-8" });
    await expect(store.purge("u1", conv.id)).rejects.toThrow();
    await store.archive("u1", conv.id);
    expect(await store.purge("u1", conv.id)).toBe(true);
    expect(await store.get("u1", conv.id)).toBeNull();
    expect((await store.list("u1", { archived: true })).length).toBe(0);
  });

  it("purge 不存在的会话返回 false", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-purge2-"));
    const store = mkStore(base);
    expect(await store.purge("u1", "no-such")).toBe(false);
  });

  it("端点:POST purge 对活会话 409,归档后 200;列表 archived 兼容字符串 true", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-purge3-"));
    const store = mkStore(base);
    const conv = await store.create("u1", { model: "m" });
    const deps = { store, username: "u1", captureSearched: async () => {} };
    const r409 = await handleConversationAction("POST", conv.id, { action: "purge" }, deps as never);
    expect(r409.status).toBe(409);
    await store.archive("u1", conv.id);
    const listStr = await handleConversationAction("GET", null, { archived: "true" }, deps as never);
    expect(Array.isArray(listStr.json)).toBe(true);
    expect((listStr.json as Array<{ id: string }>).some((s) => s.id === conv.id)).toBe(true);
    const r200 = await handleConversationAction("POST", conv.id, { action: "purge" }, deps as never);
    expect(r200.status).toBe(200);
  });
});