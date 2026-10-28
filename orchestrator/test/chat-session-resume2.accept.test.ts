import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../src/chat/conversation-store.js";
import { chatInvocation } from "../src/server/workspace-endpoints.js";

describe("cliSessionId 落库与 resume 调用(作者验收)", () => {
  it("chatInvocation claude 分支带 --resume", () => {
    const inv = chatInvocation("claude-opus-4-8", [], false, undefined, false, "sess-xyz");
    expect(inv.codex).toBe(false);
    const i = inv.args.indexOf("--resume");
    expect(i).toBeGreaterThan(-1);
    expect(inv.args[i + 1]).toBe("sess-xyz");
  });

  it("chatInvocation 无 resume 参数时不带 --resume(现状不变)", () => {
    const inv = chatInvocation("claude-opus-4-8", [], false);
    expect(inv.args.indexOf("--resume")).toBe(-1);
  });

  it("codex 分支忽略 resumeSessionId", () => {
    const inv = chatInvocation("gpt-5.6-sol", [], false, undefined, false, "sess-xyz");
    expect(inv.codex).toBe(true);
    expect(inv.args.indexOf("--resume")).toBe(-1);
  });

  it("setCliSessionId 持久化且不存在的会话静默", async () => {
    const base = await mkdtemp(join(tmpdir(), "kp-resume-"));
    let n = 0;
    const store = new ConversationStore(base, { now: () => ++n, id: () => `conv-${++n}` });
    const conv = await store.create("u1", { model: "claude-opus-4-8" });
    await store.setCliSessionId("u1", conv.id, "sess-1");
    const got = await store.get("u1", conv.id);
    expect(got?.cliSessionId).toBe("sess-1");
    await expect(store.setCliSessionId("u1", "no-such", "s")).resolves.toBeUndefined();
  });
});