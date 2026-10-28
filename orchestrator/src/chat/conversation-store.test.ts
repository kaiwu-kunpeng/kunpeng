import { mkdtempSync, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { ConversationStore, deriveTitle } from "./conversation-store.js";

function makeStore(base: string) {
  let n = 1000;
  let k = 0;
  return new ConversationStore(base, {
    now: () => ++n,
    id: () => `conv-${++k}`,
  });
}

describe("deriveTitle", () => {
  test("uses first user turn truncated", () => {
    expect(
      deriveTitle([{ role: "user", text: "帮我分析竞品定价策略和市场份额变化趋势细节" }]),
    ).toBe("帮我分析竞品定价策略和市场份额变化趋势细节".slice(0, 30));
  });
  test("falls back when no user turn", () => {
    expect(deriveTitle([])).toBe("新对话");
  });
});

describe("ConversationStore", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "kp-chat-"));
  });

  test("create then get round-trips, archived=false", async () => {
    const s = makeStore(base);
    const c = await s.create("alice", { model: "claude-opus-4-8" });
    expect(c.id).toBe("conv-1");
    expect(c.username).toBe("alice");
    expect(c.archived).toBe(false);
    const got = await s.get("alice", c.id);
    expect(got?.model).toBe("claude-opus-4-8");
    expect(got?.sensitiveEver).toBe(false);
  });

  test("sensitiveEver becomes permanent and a fork inherits it after unlock", async () => {
    const s = makeStore(base);
    const c = await s.create("alice", { model: "m", sensitive: true });
    await s.setSensitive("alice", c.id, false);

    const unlocked = await s.get("alice", c.id);
    expect(unlocked?.sensitive).toBe(false);
    expect(unlocked?.sensitiveEver).toBe(true);

    const forked = await s.fork("alice", c.id);
    expect(forked?.sensitive).toBe(false);
    expect(forked?.sensitiveEver).toBe(true);
  });

  test("legacy conversations without sensitiveEver migrate fail-closed", async () => {
    const s = makeStore(base);
    const userDir = join(base, "alice");
    await fs.mkdir(userDir, { recursive: true });
    await fs.writeFile(join(userDir, "legacy.json"), `${JSON.stringify({
      schemaVersion: 1,
      id: "legacy",
      title: "legacy",
      username: "alice",
      model: "m",
      createdAt: 1,
      updatedAt: 1,
      archived: false,
      sensitive: false,
      turns: [],
    })}\n`, "utf8");

    const migrated = await s.get("alice", "legacy");
    expect(migrated?.schemaVersion).toBe(2);
    expect(migrated?.sensitive).toBe(false);
    expect(migrated?.sensitiveEver).toBe(true);
  });

  test("ISOLATION: bob cannot read alice's conversation", async () => {
    const s = makeStore(base);
    const c = await s.create("alice", { model: "m" });
    expect(await s.get("bob", c.id)).toBeNull();
    const bobList = await s.list("bob");
    expect(bobList).toHaveLength(0);
  });

  test("appendTurns sets title from first user turn and bumps updatedAt", async () => {
    const s = makeStore(base);
    const c = await s.create("alice", { model: "m" });
    await s.appendTurns("alice", c.id, [
      { role: "user", text: "查一下东京天气" },
      { role: "assistant", text: "好的" },
    ]);
    const got = await s.get("alice", c.id);
    expect(got?.title).toBe("查一下东京天气");
    expect(got?.turns).toHaveLength(2);
    expect(got?.updatedAt).toBeGreaterThan(c.createdAt);
  });

  test("list excludes archived, sorted by updatedAt desc, with messageCount", async () => {
    const s = makeStore(base);
    const a = await s.create("alice", { model: "m" });
    const b = await s.create("alice", { model: "m" });
    await s.appendTurns("alice", b.id, [{ role: "user", text: "hi" }]);
    await s.archive("alice", a.id);
    const list = await s.list("alice");
    expect(list.map((x) => x.id)).toEqual([b.id]);
    expect(list[0]?.messageCount).toBe(1);
    const withArchived = await s.list("alice", { archived: true });
    expect(withArchived.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  test("SOFT DELETE: archive keeps the file on disk", async () => {
    const s = makeStore(base);
    const c = await s.create("alice", { model: "m" });
    await s.archive("alice", c.id);
    const file = join(base, "alice", `${c.id}.json`);
    expect(existsSync(file)).toBe(true);
    expect((await s.get("alice", c.id))?.archived).toBe(true);
  });

  test("list rebuilds when index.json is missing", async () => {
    const s = makeStore(base);
    const c = await s.create("alice", { model: "m" });
    await fs.rm(join(base, "alice", "index.json"), { force: true });
    const list = await s.list("alice");
    expect(list.map((x) => x.id)).toEqual([c.id]);
  });
});
