import { describe, it, expect } from "vitest";
import { conversationToMarkdown } from "../../src/chat/conversation-store.js";

describe("conversationToMarkdown", () => {
  it("标题 + 用户/助手分段 + 模型标注", () => {
    const md = conversationToMarkdown({
      title: "增长讨论",
      turns: [
        { role: "user", text: "怎么提升转化?" },
        { role: "assistant", text: "先定位漏点。", usage: { model: "claude-opus-4-8" } },
      ],
    });
    expect(md).toContain("# 增长讨论");
    expect(md).toContain("## 用户");
    expect(md).toContain("怎么提升转化?");
    expect(md).toContain("## 助手");
    expect(md).toContain("先定位漏点。");
    expect(md).toContain("claude-opus-4-8");
  });

  it("无标题兜底 + 空 turns 只出标题", () => {
    expect(conversationToMarkdown({ title: "", turns: [] })).toContain("未命名会话");
    const only = conversationToMarkdown({ title: "T", turns: [] });
    expect(only).toContain("# T");
    expect(only).not.toContain("## ");
  });

  it("助手无 usage.model 时不加模型标注", () => {
    const md = conversationToMarkdown({ title: "X", turns: [{ role: "assistant", text: "答复" }] });
    expect(md).toContain("## 助手");
    expect(md).toContain("答复");
    expect(md).not.toContain("_(");
  });
});