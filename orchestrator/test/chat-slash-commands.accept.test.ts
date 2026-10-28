import { describe, expect, it } from "vitest";
import { CHAT_COMMANDS, matchChatCommand } from "../src/server/chat-commands.js";

describe("斜杠命令体系(作者验收)", () => {
  it("注册表覆盖核心命令集", () => {
    const names = CHAT_COMMANDS.map((c) => c.name);
    for (const n of ["help", "loop", "ask", "code", "model", "cost", "status", "skills", "skill", "capture"]) {
      expect(names).toContain(n);
    }
    for (const c of CHAT_COMMANDS) {
      expect(c.usage.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it("matchChatCommand 解析与边界", () => {
    expect(matchChatCommand("/help")).toEqual({ name: "help", rest: "" });
    expect(matchChatCommand("  /model gpt-5.6-sol ")).toEqual({ name: "model", rest: "gpt-5.6-sol" });
    expect(matchChatCommand("/skill strategy-doc 帮我写方案")?.name).toBe("skill");
    expect(matchChatCommand("普通消息")).toBeNull();
    expect(matchChatCommand("/notacmd xx")).toBeNull();
    expect(matchChatCommand("/loopX 不是loop")).toBeNull();
  });
});
