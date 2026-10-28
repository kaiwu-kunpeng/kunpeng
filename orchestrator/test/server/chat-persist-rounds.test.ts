import { describe, it, expect } from "vitest";
import { resolveChatReplyText } from "../../src/server/workspace-endpoints.js";

describe("resolveChatReplyText — 空回复不丢整轮(C-corr5)", () => {
  it("有文本、未中断 → 原文", () => {
    expect(resolveChatReplyText("已完成分析", false)).toBe("已完成分析");
  });

  it("中断 → 带中断标记(动作未执行提示)", () => {
    const r = resolveChatReplyText("正在写文件", true);
    expect(r.startsWith("正在写文件")).toBe(true);
    expect(r).toContain("连接中断");
    expect(r).toContain("并未执行");
  });

  it("空回复、未中断 → 明确占位(仅工具轮),不返回空串", () => {
    const r = resolveChatReplyText("", false);
    expect(r.trim().length).toBeGreaterThan(0);
    expect(r).toContain("工具");
  });

  it("纯空白视同空回复给占位", () => {
    const r = resolveChatReplyText("   \n  ", false);
    expect(r).toContain("工具");
  });

  it("中断但答复为空 → 仍带中断标记", () => {
    const r = resolveChatReplyText("", true);
    expect(r).toContain("连接中断");
  });
});