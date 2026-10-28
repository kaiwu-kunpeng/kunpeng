import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../../src/chat/conversation-store.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "kp-conv-conc-"));
  let clock = 1000;
  let seq = 0;
  return new ConversationStore(dir, { now: () => (clock += 1), id: () => `conv-${++seq}` });
}

describe("对话存储并发安全(作者验收)", () => {
  it("并发 appendTurns 到同一会话不丢轮", async () => {
    const store = freshStore();
    const conv = await store.create("u", { model: "m" });
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, (_v, i) =>
        store.appendTurns("u", conv.id, [{ role: "user", text: "q" + i, at: i }]),
      ),
    );
    const got = await store.get("u", conv.id);
    expect(got).toBeTruthy();
    expect(got!.turns.length).toBe(N);
  });

  it("并发追加到不同会话互不影响", async () => {
    const store = freshStore();
    const a = await store.create("u", { model: "m" });
    const b = await store.create("u", { model: "m" });
    await Promise.all([
      ...Array.from({ length: 10 }, (_v, i) => store.appendTurns("u", a.id, [{ role: "user", text: "a" + i, at: i }])),
      ...Array.from({ length: 7 }, (_v, i) => store.appendTurns("u", b.id, [{ role: "user", text: "b" + i, at: i }])),
    ]);
    expect((await store.get("u", a.id))!.turns.length).toBe(10);
    expect((await store.get("u", b.id))!.turns.length).toBe(7);
  });
});