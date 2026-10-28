import { describe, expect, test } from "vitest";
import { gateCardsText, renderGateCardsReply, type GateCardData } from "../../src/server/chat-commands.js";
import { resolveCliSessionAction } from "../../src/server/chat-stream.js";
import { createChatRun } from "../../src/server/chat-run-bus.js";

const card = (over: Partial<GateCardData> = {}): GateCardData => ({
  id: "flow-1",
  planId: null,
  kind: "human",
  title: "合并门待审",
  branch: "kp/flow-1",
  project: { id: "p1", name: "鲲鹏" },
  createdAt: null,
  ...over,
});

describe("A:/gates 入库必须是纯文本", () => {
  test("空列表与 HTML 版逐字一致", () => {
    expect(gateCardsText([])).toBe(renderGateCardsReply([]));
    expect(gateCardsText([])).toBe("当前没有待审门 ✅");
  });

  test("非空时是纯文本,不含标签与卡片属性", () => {
    const out = gateCardsText([card(), card({ id: "flow-2", title: "人工确认", branch: null })]);
    expect(out).not.toContain("<");
    expect(out).not.toContain("data-gate-card");
    expect(out.split("\n")[0]).toBe("待审门 2 个:");
    expect(out).toContain("- [鲲鹏] 合并门待审 (kp/flow-1)");
    expect(out).toContain("- [鲲鹏] 人工确认");
  });

  test("branch 为空时不带括号尾巴", () => {
    expect(gateCardsText([card({ branch: null })])).toBe("待审门 1 个:\n- [鲲鹏] 合并门待审");
  });

  test("renderGateCardsReply 仍返回 HTML(未被改坏)", () => {
    expect(renderGateCardsReply([card()])).toContain("data-gate-card=");
  });
});

describe("B:续跑回退后不得写回 session id", () => {
  test("compact 轮永远 clear", () => {
    expect(resolveCliSessionAction({ isCompactRound: true, latestSessionId: "s1", resumeFallback: false })).toEqual({ kind: "clear" });
    expect(resolveCliSessionAction({ isCompactRound: true, latestSessionId: "s1", resumeFallback: true })).toEqual({ kind: "clear" });
  });

  test("关键边界:回退轮即使拿到 session id 也不写回", () => {
    expect(resolveCliSessionAction({ isCompactRound: false, latestSessionId: "s-broken", resumeFallback: true })).toEqual({ kind: "none" });
  });

  test("正常轮拿到 id 就写回,原值不被 trim 改写", () => {
    expect(resolveCliSessionAction({ isCompactRound: false, latestSessionId: " s1 ", resumeFallback: false })).toEqual({ kind: "set", sessionId: " s1 " });
  });

  test("没有 id 或 id 为空白时什么都不做", () => {
    expect(resolveCliSessionAction({ isCompactRound: false, resumeFallback: false })).toEqual({ kind: "none" });
    expect(resolveCliSessionAction({ isCompactRound: false, latestSessionId: "  ", resumeFallback: false })).toEqual({ kind: "none" });
  });
});

describe("C:同会话新 run 必须接管旧 run", () => {
  test("旧 run 被 abort 并收尾,订阅者拿到 END", () => {
    const key = "u/conv-takeover";
    const first = createChatRun(key);
    let aborted = 0;
    first.bindAbort(() => { aborted += 1; });
    const frames: string[] = [];
    first.subscribe({ write: (chunk: string) => { frames.push(chunk); return true; } });

    createChatRun(key);

    expect(aborted).toBe(1);
    expect(first.done).toBe(true);
    expect(frames.some((f) => f.includes("event: end"))).toBe(true);
  });

  test("旧 run 已结束时不再触发 abort", () => {
    const key = "u/conv-done";
    const first = createChatRun(key);
    let aborted = 0;
    first.bindAbort(() => { aborted += 1; });
    first.endRun();

    createChatRun(key);

    expect(aborted).toBe(0);
  });

  test("首次创建同 key 不受影响", () => {
    const run = createChatRun("u/conv-fresh");
    expect(run.done).toBe(false);
    expect(run.seq).toBe(0);
  });
});