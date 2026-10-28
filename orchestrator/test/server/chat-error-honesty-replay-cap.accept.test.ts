import { describe, expect, test } from "vitest";
import { resolveChatReplyText, buildChatPrompt } from "../../src/server/chat-stream.js";
import { capReplayTurns } from "../../src/server/chat-persistence.js";
import type { ChatTurn as StoredChatTurn } from "../../src/chat/conversation-store.js";

const t = (text: string, role: "user" | "assistant" = "user"): StoredChatTurn => ({ role, text });

describe("A:出错轮次必须如实入库", () => {
  test("中断轮文案不变(墙钟/空闲/普通中断)", () => {
    expect(resolveChatReplyText("半句", true, "wall")).toContain("跑满 3 小时上限");
    expect(resolveChatReplyText("半句", true, "idle")).toContain("5 分钟无任何输出");
    expect(resolveChatReplyText("半句", true)).toContain("连接中断、进程被终止");
    expect(resolveChatReplyText("半句", true, "wall", "忽略我")).not.toContain("本轮出错");
  });

  test("出错且未中断:必须带错误原文,不得说成仅执行了工具", () => {
    const out = resolveChatReplyText("", false, undefined, "对话进程异常退出(exit 1)");
    expect(out).toContain("⚠️[本轮出错:对话进程异常退出(exit 1)");
    expect(out).not.toContain("可能仅执行了工具操作");
    expect(out.startsWith("⚠️[本轮出错:")).toBe(true);
  });

  test("有正文时错误提示追加在正文之后", () => {
    const out = resolveChatReplyText("已经写了一半", false, undefined, "boom");
    expect(out.startsWith("已经写了一半")).toBe(true);
    expect(out).toContain("⚠️[本轮出错:boom");
  });

  test("无错误无中断:与旧行为逐字一致", () => {
    expect(resolveChatReplyText("正常回答", false)).toBe("正常回答");
    expect(resolveChatReplyText("", false)).toBe("(本轮无文本回复，可能仅执行了工具操作)");
    expect(resolveChatReplyText("", false, undefined, "   ")).toBe("(本轮无文本回复，可能仅执行了工具操作)");
  });
});

describe("B:回放历史必须有上限", () => {
  test("未超限时原样返回且引用不变", () => {
    const turns = [t("aa"), t("bb")];
    const out = capReplayTurns(turns, 100);
    expect(out.dropped).toBe(0);
    expect(out.turns).toHaveLength(2);
    expect(out.turns[0]).toBe(turns[0]);
  });

  test("从尾部收取,超限的更早轮被丢弃", () => {
    const turns = [t("1234567890"), t("abc"), t("de")];
    const out = capReplayTurns(turns, 6);
    expect(out.turns.map((x) => x.text)).toEqual(["abc", "de"]);
    expect(out.dropped).toBe(1);
  });

  test("至少保留最后一条,哪怕它本身超限", () => {
    const turns = [t("aaa"), t("超长超长超长超长")];
    const out = capReplayTurns(turns, 1);
    expect(out.turns).toHaveLength(1);
    expect(out.turns[0].text).toBe("超长超长超长超长");
    expect(out.dropped).toBe(1);
  });

  test("maxChars 非法时只保留最后一条", () => {
    const turns = [t("a"), t("b"), t("c")];
    expect(capReplayTurns(turns, 0).turns.map((x) => x.text)).toEqual(["c"]);
    expect(capReplayTurns(turns, Number.NaN).turns.map((x) => x.text)).toEqual(["c"]);
    expect(capReplayTurns(turns, -5).dropped).toBe(2);
  });

  test("空输入不炸", () => {
    expect(capReplayTurns([], 100)).toEqual({ turns: [], dropped: 0 });
  });
});

describe("接线:截断提示只在丢弃时出现", () => {
  test("不传 opts 与传 0 时输出一致", () => {
    const hist = [t("你好"), t("在", "assistant")];
    expect(buildChatPrompt(hist, "继续")).toBe(buildChatPrompt(hist, "继续", "act", { droppedTurns: 0 }));
  });

  test("传正数时多出提示行", () => {
    const hist = [t("你好")];
    const withNote = buildChatPrompt(hist, "继续", "act", { droppedTurns: 7 });
    expect(withNote).toContain("更早的 7 轮历史因过长未回放");
    expect(buildChatPrompt(hist, "继续")).not.toContain("因过长未回放");
  });
});