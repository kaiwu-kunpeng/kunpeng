import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../src/chat/conversation-store.js";

function mkStore(base: string, nowRef: { v: number }) {
  let n = 0;
  return new ConversationStore(base, { now: () => nowRef.v, id: () => `c-${++n}` });
}

describe("会话 TTL(作者验收)", () => {
  it("setTtlDays 持久化与清除", async () => {
    const nowRef = { v: 1000 };
    const store = mkStore(await mkdtemp(join(tmpdir(), "kp-ttl-")), nowRef);
    const conv = await store.create("u1", { model: "m" });
    await store.setTtlDays("u1", conv.id, 7);
    expect((await store.get("u1", conv.id))?.ttlDays).toBe(7);
    await store.setTtlDays("u1", conv.id, null);
    expect((await store.get("u1", conv.id))?.ttlDays).toBeUndefined();
  });
  it("过期归档,未过期保留,无 ttl 永久", async () => {
    const nowRef = { v: 1000 };
    const store = mkStore(await mkdtemp(join(tmpdir(), "kp-ttl2-")), nowRef);
    const a = await store.create("u1", { model: "m" });
    await store.setTtlDays("u1", a.id, 7);
    const b = await store.create("u1", { model: "m" });
    await store.setTtlDays("u1", b.id, 90);
    const c = await store.create("u1", { model: "m" });
    const archived = await store.archiveExpired("u1", 1000 + 8 * 86400000);
    expect(archived).toContain(a.id);
    expect(archived).not.toContain(b.id);
    expect(archived).not.toContain(c.id);
  });
});