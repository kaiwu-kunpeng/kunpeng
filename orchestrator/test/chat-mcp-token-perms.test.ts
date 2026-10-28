import { describe, it, expect } from "vitest";
import { mkdtemp, rm, stat, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLocalFsMcpConfig } from "../src/server/chat-stream.js";
import { kunpengStateDir } from "../src/project/registry.js";

async function countRealResidue(): Promise<number> {
  try {
    const files = await readdir(join(kunpengStateDir(), "chat-mcp"));
    return files.filter((f) => f.startsWith("conv-perm-test-")).length;
  } catch {
    return 0;
  }
}

describe("chat-mcp 配置写出", () => {
  it("传入 baseDir 时写到该目录,权限 0600,且不碰真实状态目录", async () => {
    const before = await countRealResidue();
    const dir = await mkdtemp(join(tmpdir(), "kp-mcp-"));
    try {
      const p = await writeLocalFsMcpConfig("conv-perm-test-isolated", "tok-abc", dir);
      expect(p.startsWith(dir)).toBe(true);
      expect((await stat(p)).mode & 0o777).toBe(0o600);
      const body = JSON.parse(await readFile(p, "utf8"));
      expect(body.mcpServers?.localfs).toBeTruthy();
      expect(body.mcpServers.localfs.env?.KP_LOCALFS_CONV).toBe("conv-perm-test-isolated");
      expect(body.mcpServers.localfs.env?.KP_LOCALFS_TOKEN).toBe("tok-abc");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(await countRealResidue()).toBe(before);
  });

  it("不传 baseDir 时仍写到 kunpengStateDir()/chat-mcp(向后兼容)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-mcp-compat-"));
    try {
      const p = await writeLocalFsMcpConfig("kp-compat-probe", "tok-x", dir);
      expect(p).toBe(join(dir, "chat-mcp", "kp-compat-probe.localfs.mcp.json"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("整套测试跑完,真实 chat-mcp 目录没有新增 conv-perm-test-* 残留", async () => {
    const before = await countRealResidue();
    const dir = await mkdtemp(join(tmpdir(), "kp-mcp-leak-"));
    try {
      for (let i = 0; i < 3; i += 1) {
        await writeLocalFsMcpConfig(`conv-perm-test-leak-${i}`, "tok-abc", dir);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(await countRealResidue()).toBe(before);
  });
});