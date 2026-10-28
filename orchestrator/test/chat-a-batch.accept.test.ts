import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";
import { formatChatUsageLine, sumConversationUsd } from "../src/server/chat-usage.js";

const clientSrc = clientSource();

describe("对话A批(作者验收)", () => {
  it("会话累计拼进用量行,无第3参行为不变", () => {
    const withTotal = formatChatUsageLine({ input: 100, output: 50, model: "claude-opus-4-8" }, undefined, 1.2345);
    expect(withTotal).toContain("会话累计 $1.2345");
    const plain = formatChatUsageLine({ input: 100, output: 50, model: "claude-opus-4-8" });
    expect(plain).not.toContain("会话累计");
    expect(plain).toContain("in 100");
  });

  it("sumConversationUsd 累加有 usage 的轮,跳过无 usage", () => {
    const total = sumConversationUsd([
      { usage: { input: 1000, output: 1000, model: "claude-opus-4-8" } },
      {},
      { usage: { input: 2000, output: 0, model: "claude-opus-4-8" } },
    ]);
    expect(total).toBeGreaterThan(0);
    expect(sumConversationUsd([])).toBe(0);
  });

  it("client 有队列与语音接线", () => {
    expect(clientSrc).toContain("SpeechRecognition");
    expect(clientSrc.includes("排队") || clientSrc.includes("\\u6392\\u961F")).toBe(true);
    expect(clientSrc).toContain("kp-mic-on");
  });
});
