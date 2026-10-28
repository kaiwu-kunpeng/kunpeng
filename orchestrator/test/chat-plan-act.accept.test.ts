import { describe, expect, it } from "vitest";
import { resolveChatMode } from "../src/server/workspace-endpoints.js";

describe("Plan/Act 双模(作者验收)", () => {
  it("/ask 前缀单条切 plan 并去前缀", () => {
    const r = resolveChatMode("/ask 这个架构有什么问题?", undefined);
    expect(r.mode).toBe("plan");
    expect(r.cleanMessage).toBe("这个架构有什么问题?");
  });

  it("/code 与 /act 前缀强制 act", () => {
    expect(resolveChatMode("/code 改吧", "plan").mode).toBe("act");
    expect(resolveChatMode("/act 上", "plan").mode).toBe("act");
    expect(resolveChatMode("/code 改吧", "plan").cleanMessage).toBe("改吧");
  });

  it("无前缀时跟 UI 档;缺省 act", () => {
    expect(resolveChatMode("随便聊聊", "plan").mode).toBe("plan");
    expect(resolveChatMode("随便聊聊", undefined).mode).toBe("act");
    expect(resolveChatMode("随便聊聊", "act").cleanMessage).toBe("随便聊聊");
  });
});