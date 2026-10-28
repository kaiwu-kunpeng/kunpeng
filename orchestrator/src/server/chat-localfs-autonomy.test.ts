import { describe, it, expect } from "vitest";
import { buildChatPrompt } from "./workspace-endpoints.js";

// 需求锚点:用户在对话里"选定/授权本地目录"这一动作本身即为确认与授权,
// 助手必须直接读取该目录并推进任务(汇总/批量处理/按一句话指令执行),
// 不得反复追问澄清、也不得要求用户口述补充需求。
describe("chat 提示:选定目录即确认,禁止反复追问/要求口述", () => {
  const prompt = buildChatPrompt([], "帮我看下这个目录", "act");

  it("act 模式提示里含『选定目录=已确认』直接干规则", () => {
    expect(prompt).toContain("选定目录=已确认");
  });

  it("明确禁止再反问澄清", () => {
    expect(prompt).toContain("不得再反问");
  });

  it("明确不要求用户口述补充需求", () => {
    expect(prompt).toContain("不要求用户口述");
  });

  it("声明选定目录后即可汇总/批量处理/按一句话指令执行", () => {
    expect(prompt).toContain("汇总");
    expect(prompt).toContain("批量处理");
  });
});