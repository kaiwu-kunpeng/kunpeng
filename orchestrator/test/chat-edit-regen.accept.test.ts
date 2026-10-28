import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../src/chat/conversation-store.js";

function mkStore(base: string) {
  let n = 0;
  return new ConversationStore(base, { now: () => ++n, id: () => `c-${++n}` });
}

describe("编辑重发/重新生成(作者验收)", () => {
  it("replaceLastRound 覆盖尾轮并留档旧回复", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-regen-"));
    const store = mkStore(base);
    const conv = await store.create("u1", { model: "m" });
    await store.appendTurns("u1", conv.id, [{ role: "user", text: "问A" }, { role: "assistant", text: "答A1" }]);
    const updated = await store.replaceLastRound("u1", conv.id, { userText: "问A改", replyText: "答A2" });
    expect(updated).not.toBeNull();
    const turns = updated!.turns;
    const lastUser = [...turns].reverse().find((t) => t.role === "user");
    const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
    expect(lastUser?.text).toBe("问A改");
    expect(lastAssistant?.text).toBe("答A2");
    const alts = (lastAssistant as { alternatives?: Array<{ text: string }> }).alternatives ?? [];
    expect(alts.some((a) => a.text === "答A1")).toBe(true);
  });

  it("空会话 replaceLastRound 返回 null;再次替换 alternatives 累积", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-regen2-"));
    const store = mkStore(base);
    const conv = await store.create("u1", { model: "m" });
    expect(await store.replaceLastRound("u1", conv.id, { userText: "x", replyText: "y" })).toBeNull();
    await store.appendTurns("u1", conv.id, [{ role: "user", text: "q" }, { role: "assistant", text: "a1" }]);
    await store.replaceLastRound("u1", conv.id, { userText: "q", replyText: "a2" });
    const updated = await store.replaceLastRound("u1", conv.id, { userText: "q", replyText: "a3" });
    const lastAssistant = [...updated!.turns].reverse().find((t) => t.role === "assistant") as { alternatives?: Array<{ text: string }> };
    expect((lastAssistant.alternatives ?? []).length).toBe(2);
  });
});