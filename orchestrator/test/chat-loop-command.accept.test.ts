import { describe, expect, it } from "vitest";
import { parseChatLoopCommand } from "../src/server/workspace-endpoints.js";

describe("对话 /loop 命令(作者验收)", () => {
  it("命中 /loop 提取需求并打 [chat] 前缀", () => {
    const r = parseChatLoopCommand("  /loop 给 cost-report 加 --project 过滤 ");
    expect(r).not.toBeNull();
    expect(r!.requirement).toBe("[chat] 给 cost-report 加 --project 过滤");
  });

  it("非命令与空需求返回 null", () => {
    expect(parseChatLoopCommand("普通聊天")).toBeNull();
    expect(parseChatLoopCommand("/loop   ")).toBeNull();
    expect(parseChatLoopCommand("/loops x")).toBeNull();
  });
});