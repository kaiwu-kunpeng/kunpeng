import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../src/chat/conversation-store.js";

function mkStore(base: string) {
  let n = 0;
  return new ConversationStore(base, { now: () => ++n, id: () => `c-${++n}` });
}

describe("会话搜索+置顶(作者验收)", () => {
  it("全文搜索命中 turns 且带 snippet", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-cs-"));
    const store = mkStore(base);
    const a = await store.create("u1", { model: "m" });
    await store.appendTurns("u1", a.id, [
      { role: "user", text: "帮我查一下 Kubernetes 的滚动升级策略" },
      { role: "assistant", text: "滚动升级用 RollingUpdate……" },
    ]);
    const b = await store.create("u1", { model: "m" });
    await store.appendTurns("u1", b.id, [{ role: "user", text: "写首诗" }, { role: "assistant", text: "好" }]);
    const hits = await store.searchConversations("u1", "kubernetes");
    expect(hits.length).toBe(1);
    expect(hits[0]!.id).toBe(a.id);
    expect(hits[0]!.snippet).toContain("【");
    expect((await store.searchConversations("u1", "  ")).length).toBe(0);
  });
  it("setPinned 持久化", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-cs2-"));
    const store = mkStore(base);
    const conv = await store.create("u1", { model: "m" });
    await store.setPinned("u1", conv.id, true);
    expect((await store.get("u1", conv.id))?.pinned).toBe(true);
    await store.setPinned("u1", conv.id, false);
    expect((await store.get("u1", conv.id))?.pinned).toBe(false);
  });
});