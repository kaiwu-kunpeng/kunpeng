import { stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { writeLocalFsMcpConfig } from "../src/server/chat-stream.js";

describe("chat-mcp token 文件权限", () => {
  it("写出的 localfs mcp 配置为 0600(仅属主可读写)", async () => {
    const p = await writeLocalFsMcpConfig("conv-perm-test-" + Date.now().toString(36), "tok-abc");
    const mode = (await stat(p)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});