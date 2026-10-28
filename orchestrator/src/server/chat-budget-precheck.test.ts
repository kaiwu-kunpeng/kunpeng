import { describe, expect, it } from "vitest";

import { chatBudgetVerdict } from "./chat-stream.js";

describe("chat 轮前预算预检", () => {
  it("未设/非法/零预算:永不拦截", () => {
    expect(chatBudgetVerdict(999, {}).block).toBe(false);
    expect(chatBudgetVerdict(999, { KUNPENG_CHAT_SESSION_USD_BUDGET: "abc" }).block).toBe(false);
    expect(chatBudgetVerdict(999, { KUNPENG_CHAT_SESSION_USD_BUDGET: "0" }).block).toBe(false);
  });

  it("会话累计不可知:不拦截", () => {
    expect(chatBudgetVerdict(undefined, { KUNPENG_CHAT_SESSION_USD_BUDGET: "5" }).block).toBe(false);
  });

  it("达到/超过预算:拦截且提示含预算变量名", () => {
    const v = chatBudgetVerdict(5.2, { KUNPENG_CHAT_SESSION_USD_BUDGET: "5" });
    expect(v.block).toBe(true);
    expect(String(v.message)).toContain("KUNPENG_CHAT_SESSION_USD_BUDGET");
    expect(String(v.message)).toContain("5.20");
  });

  it("未达预算:放行", () => {
    expect(chatBudgetVerdict(1, { KUNPENG_CHAT_SESSION_USD_BUDGET: "5" }).block).toBe(false);
  });
});