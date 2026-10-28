import { describe, expect, test } from "vitest";
import { buildChatPrompt } from "../workspace-endpoints.js";
import { buildLocalFsMcpConfig } from "./chat-wiring.js";

describe("chat 接线 localfs", () => {
  test("系统提示词告知用 localfs_* 工具操作浏览器授权目录", () => {
    const p = buildChatPrompt([], "hi");
    expect(p).toContain("localfs_");
    expect(p).toContain("授权");
  });

  test("MCP 配置含 localfs server 且注入 conv 与 enqueue url", () => {
    const cfg = buildLocalFsMcpConfig("conv-123", "http://127.0.0.1:7788");
    const s = JSON.stringify(cfg);
    expect(s).toContain("localfs");
    expect(s).toContain("conv-123");
    expect(s).toContain("7788");
  });
});
