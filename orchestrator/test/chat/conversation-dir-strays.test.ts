import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConversationStore,
  classifyConversationDirEntries,
} from "../../src/chat/conversation-store.js";

const roots: string[] = [];

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("classifyConversationDirEntries", () => {
  it("索引跳过、会话进 ids 并排序、游离文件进 strays 且保持传入顺序", () => {
    const out = classifyConversationDirEntries([
      "index.json",
      "conv-b.json",
      "conv-a.json",
      "conv-a.json.bak",
      "notes.txt",
      "%zz.json",
    ]);
    expect(out.ids).toEqual(["conv-a", "conv-b"]);
    expect(out.strays).toEqual(["conv-a.json.bak", "notes.txt", "%zz.json"]);
  });

  it("全是游离文件时 ids 为空数组而不是抛错", () => {
    const out = classifyConversationDirEntries(["a.json.bak", "b.tmp"]);
    expect(out.ids).toEqual([]);
    expect(out.strays).toEqual(["a.json.bak", "b.tmp"]);
  });

  it("空目录 → ids 与 strays 都是空数组", () => {
    const out = classifyConversationDirEntries([]);
    expect(out.ids).toEqual([]);
    expect(out.strays).toEqual([]);
  });
});

describe("owner 目录含 .bak 时的迁移（2026-08-06 502 故障回归）", () => {
  it("目录里有 .bak 备份，migrateOwner 仍跑通且旧会话在新账号下可读", async () => {
    const stateDir = temp("kp-conv-stray-");
    const store = new ConversationStore(join(stateDir, "chat"), {
      now: () => 1000,
      id: () => "conv-stray-1",
    });
    const legacy = await store.create("admin", {
      model: "claude-opus-5",
      projectId: "kunpeng",
    });
    await store.appendTurns("admin", legacy.id, [
      { role: "user", text: "KEEP-ME-7" },
      { role: "assistant", text: "收到" },
    ]);

    writeFileSync(
      join(stateDir, "chat", "admin", `${legacy.id}.json.bak`),
      "{}",
      "utf8",
    );

    await store.migrateOwner("admin", "acct-admin");

    expect((await store.get("acct-admin", legacy.id))?.turns[0]?.text).toBe("KEEP-ME-7");
    expect(await store.get("admin", legacy.id)).toBeNull();
  });
});