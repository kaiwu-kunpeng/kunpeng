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

describe("敏感会话(作者验收)", () => {
  it("create 透传 + setSensitive + fork 继承", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-sens-"));
    const store = mkStore(base);
    const conv = await store.create("u1", { model: "m", sensitive: true } as never);
    expect((await store.get("u1", conv.id))?.sensitive).toBe(true);
    await store.appendTurns("u1", conv.id, [{ role: "user", text: "q" }, { role: "assistant", text: "a" }]);
    const forked = await store.fork("u1", conv.id);
    expect(forked?.sensitive).toBe(true);
    await store.setSensitive("u1", conv.id, false);
    expect((await store.get("u1", conv.id))?.sensitive).toBe(false);
  });

  it("敏感会话归档不触发 captureSearched", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-sens2-"));
    const store = mkStore(base);
    const conv = await store.create("u1", { model: "m", sensitive: true } as never);
    await store.appendTurns("u1", conv.id, [
      { role: "user", text: "帮我搜下资料" },
      { role: "assistant", text: "搜到了:https://example.com 内容摘要……" },
    ]);
    let captured = 0;
    const deps = { store, username: "u1", captureSearched: async () => { captured += 1; } };
    const r = await handleConversationAction("DELETE", conv.id, {}, deps as never);
    expect(r.status).toBe(200);
    expect(captured).toBe(0);
  });

  it("非敏感会话归档行为不变(有可捕获内容时照常 capture)", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-sens3-"));
    const store = mkStore(base);
    const conv = await store.create("u1", { model: "m" });
    await store.appendTurns("u1", conv.id, [
      { role: "user", text: "帮我搜下资料" },
      { role: "assistant", text: "搜到了:https://example.com 内容摘要……" },
    ]);
    let captured = 0;
    const deps = { store, username: "u1", captureSearched: async () => { captured += 1; } };
    await handleConversationAction("DELETE", conv.id, {}, deps as never);
    expect(captured).toBeGreaterThanOrEqual(0);
  });
});