import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InboxSeenStore } from "../../src/server/inbox-seen-store.js";
import { isInboxItemUnread } from "../../src/server/ui/views/review-inbox.js";

describe("收件箱已读/未读(作者验收)", () => {
  it("InboxSeenStore markSeen/getSeen 落盘", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-seen-"));
    const p = join(dir, "inbox-seen.json");
    const a = new InboxSeenStore(p);
    await a.markSeen(["merge:f1", "failed:f2"]);
    const seenA = await a.getSeen();
    expect(seenA.has("merge:f1")).toBe(true);
    const b = new InboxSeenStore(p);
    expect((await b.getSeen()).has("failed:f2")).toBe(true);
  });

  it("损坏文件 → 空集不抛", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-seen2-"));
    const p = join(dir, "inbox-seen.json");
    writeFileSync(p, "{ broken");
    const s = new InboxSeenStore(p);
    expect((await s.getSeen()).size).toBe(0);
  });

  it("isInboxItemUnread:seen 含则已读,否则未读", () => {
    expect(isInboxItemUnread({ kind: "merge", id: "f1" }, ["merge:f1"])).toBe(false);
    expect(isInboxItemUnread({ kind: "merge", id: "f9" }, ["merge:f1"])).toBe(true);
    expect(isInboxItemUnread({ kind: "failed", id: "x" }, undefined)).toBe(true);
  });
});