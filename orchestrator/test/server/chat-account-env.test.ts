import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatAccountEnv, recordChatUsage } from "../../src/server/workspace-endpoints.js";
import { loadQuota } from "../../src/agent/quota-tracker.js";

function homeWith(accounts: unknown[] | null): string {
  const home = mkdtempSync(join(tmpdir(), "kp-chat-home-"));
  if (accounts) {
    mkdirSync(join(home, ".kunpeng"), { recursive: true });
    writeFileSync(join(home, ".kunpeng", "accounts.json"), JSON.stringify(accounts), "utf8");
  }
  return home;
}

function credDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kp-chat-cred-"));
  writeFileSync(join(dir, "auth.json"), "{}", "utf8");
  return dir;
}

describe("A4:聊天接账号层", () => {
  it("无 accounts.json → 空对象(回退默认登录态)", async () => {
    expect(await chatAccountEnv(homeWith(null), "claude")).toEqual({});
  });

  it("claude 账号被选中注入 env;codex 无匹配回空", async () => {
    const dir = credDir();
    const home = homeWith([{ id: "alice", name: "alice", backend: "claude", env: { CLAUDE_CONFIG_DIR: dir } }]);
    const picked = await chatAccountEnv(home, "claude");
    expect(picked.id).toBe("alice");
    expect(picked.env?.CLAUDE_CONFIG_DIR).toBe(dir);
    expect(await chatAccountEnv(home, "codex")).toEqual({});
  });

  it("recordChatUsage 归账;无 accountId 不落文件", async () => {
    const home = homeWith([]);
    await recordChatUsage(home, "alice", "m1");
    const quota = await loadQuota(join(home, ".kunpeng", "quota.json"));
    expect(quota.accountTotal("alice", Date.now())).toBe(1);
    const home2 = homeWith(null);
    await recordChatUsage(home2, undefined, "m1");
    expect(existsSync(join(home2, ".kunpeng", "quota.json"))).toBe(false);
  });
});