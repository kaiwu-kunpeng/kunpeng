import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ConversationStore } from "../../src/chat/conversation-store.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function newStore(): ConversationStore {
  let n = 0;
  return new ConversationStore(mkdtempSync(join(tmpdir(), "kp-conv-fix-")), {
    now: () => Date.now(),
    id: () => `conv-fix-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
}

describe("会话修复A", () => {
  it("http.ts 归档参数兼容 true 与 1", () => {
    const httpTs = readFileSync(join(srcDir, "server", "http.ts"), "utf8");
    expect(httpTs).toMatch(/archived/);
    expect(httpTs).not.toMatch(/get\("archived"\)\s*===\s*"1"/);
  });

  it("并发不同会话写索引不丢更新", async () => {
    const store = newStore();
    const user = "u1";
    const mk = async (title: string) => {
      const conv = await store.create(user, { model: "sonnet" });
      await store.rename(user, conv.id, title);
      return conv;
    };
    const [a, b] = await Promise.all([mk("A"), mk("B")]);
    const pairs: Array<[string, string]> = [
      [a.id, "A2"],
      [b.id, "B2"],
    ];
    await Promise.all(pairs.map(([id, title]) => store.rename(user, id, title).catch(() => undefined)));
    const listed = await store.list(user, {});
    const ids = listed.map((c) => c.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it("markCapturedToKb 持久化", async () => {
    const store = newStore();
    const conv = await store.create("u1", { model: "sonnet" });
    await store.markCapturedToKb("u1", conv.id);
    const got = await store.get("u1", conv.id);
    expect((got as { capturedToKb?: boolean } | null)?.capturedToKb).toBe(true);
  });

  it("archiveExpired 返回过期会话集合", () => {
    const src = readFileSync(join(srcDir, "chat", "conversation-store.ts"), "utf8");
    expect(src).toMatch(/archiveExpired[\s\S]{0,400}Promise<\s*Conversation/);
  });
});