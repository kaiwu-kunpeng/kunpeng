import { describe, expect, test } from "vitest";

import { buildChatPrompt, chatInvocation } from "./workspace-endpoints.js";

describe("workbench chat capabilities unlocked", () => {
  test("系统提示词不再限制为纯文字", () => {
    const p = buildChatPrompt([], "hi");
    expect(p).not.toContain("只用文字回答");
    expect(p).not.toContain("不要修改文件或执行命令");
  });

  test("系统提示词授予完整工具能力", () => {
    const p = buildChatPrompt([], "hi");
    expect(p).toContain("工具");
    expect(p).toContain("执行命令");
    expect(p).toContain("联网");
  });

  test("claude 对话即使 web 关也保留联网与全套工具", () => {
    const inv = chatInvocation("claude-opus-4-8", [], false);
    expect(inv.args).not.toContain("--disallowedTools");
    expect(inv.args).toContain("--permission-mode");
    expect(inv.args).toContain("bypassPermissions");
  });
});