import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../../src/chat/conversation-store.js";

function freshStore(base: string) {
  let n = 0;
  return new ConversationStore(join(base, "chat"), { now: () => ++n + 1000, id: () => `conv-${++n}` });
}

describe("purge 联动删 MCP 配置(作者验收)", () => {
  it("彻底删除会话时删掉 sibling MCP 配置", async () => {
    const baseTmp = mkdtempSync(join(tmpdir(), "kp-mcpgc-"));
    const store = freshStore(baseTmp);
    const conv = await store.create("u", { model: "m" });
    await store.archive("u", conv.id);
    const mcpDir = join(baseTmp, "chat-mcp");
    mkdirSync(mcpDir, { recursive: true });
    const mcpPath = join(mcpDir, `${conv.id}.localfs.mcp.json`);
    writeFileSync(mcpPath, "{}");
    expect(existsSync(mcpPath)).toBe(true);

    const ok = await store.purge("u", conv.id);
    expect(ok).toBe(true);
    expect(existsSync(mcpPath)).toBe(false);
  });

  it("无 MCP 配置时 purge 仍正常返回 true", async () => {
    const baseTmp = mkdtempSync(join(tmpdir(), "kp-mcpgc2-"));
    const store = freshStore(baseTmp);
    const conv = await store.create("u", { model: "m" });
    await store.archive("u", conv.id);
    expect(await store.purge("u", conv.id)).toBe(true);
  });
});