import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConversationStore } from "../src/chat/conversation-store.js";

const deps = {
  now: () => Date.now(),
  id: () => `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
};

describe("会话存储健壮性", () => {
  it("用户目录混入非法 % 文件名不再炸掉整个会话列表", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-chat-robust-"));
    const store = new ConversationStore(base, deps);
    const created = await store.create("u1", { model: "claude-opus-4-8" });
    await writeFile(join(base, "u1", "bad%zz.json"), "{}", "utf8");
    await unlink(join(base, "u1", "index.json")).catch(() => {});
    const list = await store.list("u1");
    expect(list.some((summary) => summary.id === created.id)).toBe(true);
  });

  it("坏文件名只被跳过,不影响其他会话入索引", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-chat-robust-"));
    const store = new ConversationStore(base, deps);
    const a = await store.create("u2", { model: "claude-opus-4-8" });
    const b = await store.create("u2", { model: "claude-opus-4-8" });
    await writeFile(join(base, "u2", "%E4%ZZ.json"), "not-json", "utf8");
    await unlink(join(base, "u2", "index.json")).catch(() => {});
    const ids = (await store.list("u2")).map((summary) => summary.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });
});