import { describe, expect, it } from "vitest";

import { buildChatPrompt, buildResumePrompt } from "./chat-stream.js";

describe("resume 路径强制中文规则", () => {
  it("act 模式:resume prompt 含用户消息,语言规则缀在其后", () => {
    const p = buildResumePrompt("用户消息X", "act");
    expect(p).toContain("用户消息X");
    expect(p).toContain("始终使用简体中文");
    expect(p.indexOf("用户消息X")).toBeLessThan(p.indexOf("始终使用简体中文"));
  });

  it("plan 模式:Plan 约束在前,语言规则仍在", () => {
    const p = buildResumePrompt("消息Y", "plan");
    expect(p).toContain("【Plan 模式】");
    expect(p).toContain("消息Y");
    expect(p).toContain("始终使用简体中文");
  });

  it("首轮路径 buildChatPrompt 语言规则不回退", () => {
    expect(buildChatPrompt([], "你好", "act")).toContain("始终使用简体中文");
  });
});