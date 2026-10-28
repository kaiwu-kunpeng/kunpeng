import { describe, it, expect } from "vitest";
import { conversationMatchesQuery } from "../../src/chat/conversation-store.js";

describe("conversationMatchesQuery — 会话全文搜索(超越只搜标题)", () => {
  it("标题命中 → snippet 为标题", () => {
    const r = conversationMatchesQuery({ title: "DemoMarket 增长战略", turns: [] }, "增长");
    expect(r.matched).toBe(true);
    expect(r.snippet).toBe("DemoMarket 增长战略");
  });

  it("正文命中(标题不含)→ matched 且 snippet 含关键词", () => {
    const conv = { title: "随便一个标题", turns: [{ text: "前面一堆内容" }, { text: "这里讨论了 GEO 可见性的具体做法和落地" }] };
    const r = conversationMatchesQuery(conv, "GEO");
    expect(r.matched).toBe(true);
    expect(r.snippet.toLowerCase()).toContain("geo");
  });

  it("大小写不敏感", () => {
    expect(conversationMatchesQuery({ title: "T", turns: [{ text: "Hello World" }] }, "hello").matched).toBe(true);
  });

  it("都不命中 → matched false, snippet 空", () => {
    const r = conversationMatchesQuery({ title: "标题", turns: [{ text: "正文" }] }, "找不到的词");
    expect(r).toEqual({ matched: false, snippet: "" });
  });

  it("空查询 → 不命中", () => {
    expect(conversationMatchesQuery({ title: "标题", turns: [{ text: "正文" }] }, "   ")).toEqual({ matched: false, snippet: "" });
  });

  it("长正文命中给截断片段(带省略号)", () => {
    const long = "开头".repeat(40) + "关键词命中点" + "结尾".repeat(40);
    const r = conversationMatchesQuery({ title: "无关", turns: [{ text: long }] }, "关键词命中点");
    expect(r.matched).toBe(true);
    expect(r.snippet).toContain("关键词命中点");
    expect(r.snippet).toContain("…");
    expect(r.snippet.length).toBeLessThan(long.length);
  });
});