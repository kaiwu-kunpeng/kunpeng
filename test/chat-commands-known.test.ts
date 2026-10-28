import { describe, expect, it } from "vitest";
import { CHAT_COMMANDS, matchChatCommand } from "../src/server/chat-commands.js";

describe("聊天命令白名单", () => {
  it("未知斜杠开头文本按普通消息放行(返回 null)", () => {
    expect(matchChatCommand("/etc hosts 的内容如下")).toBeNull();
    expect(matchChatCommand("/usr 目录怎么清理")).toBeNull();
    expect(matchChatCommand("/foobar")).toBeNull();
  });

  it("已知命令照常解析且大小写不敏感", () => {
    expect(matchChatCommand("/help")).toEqual({ name: "help", rest: "" });
    expect(matchChatCommand("/compact 保留关键路径")).toEqual({ name: "compact", rest: "保留关键路径" });
    expect(matchChatCommand("/MODEL codex")).toEqual({ name: "model", rest: "codex" });
    expect(matchChatCommand("  /ask 这是什么  ")).toEqual({ name: "ask", rest: "这是什么" });
  });

  it("compact 已收编进命令表", () => {
    expect(CHAT_COMMANDS.some((command) => command.name === "compact")).toBe(true);
  });

  it("非命令文本不受影响", () => {
    expect(matchChatCommand("普通消息")).toBeNull();
    expect(matchChatCommand("/etc/hosts")).toBeNull();
  });
});