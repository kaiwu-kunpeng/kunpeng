import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InboxDeferStore } from "../../src/server/inbox-defer-store.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-defer-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("稍后处理存储（作者锁定）", () => {
  it("到期前在集合里、到期后自动消失；坏 key 忽略；同 key 覆盖", async () => {
    const store = new InboxDeferStore(join(dir, "inbox-deferred.json"));
    const now = 1_000_000;
    await store.markDeferred(["merge:f-1", "ops:og-1", "nope", ""], now + 3_600_000);
    expect(await store.getDeferred(now)).toEqual(new Set(["merge:f-1", "ops:og-1"]));
    expect(await store.getDeferred(now + 3_600_001)).toEqual(new Set());
    await store.markDeferred(["merge:f-1"], now + 10);
    expect(await store.getDeferred(now + 5)).toEqual(new Set(["merge:f-1", "ops:og-1"]));
    expect(await store.getDeferred(now + 11)).toEqual(new Set(["ops:og-1"]));
    const raw = JSON.parse(readFileSync(join(dir, "inbox-deferred.json"), "utf8")) as Record<string, number>;
    expect(raw["merge:f-1"]).toBe(now + 10);
  });

  it("文件缺失或损坏 → 空集合，不抛", async () => {
    const store = new InboxDeferStore(join(dir, "missing.json"));
    expect(await store.getDeferred(1)).toEqual(new Set());
    const bad = new InboxDeferStore(join(dir, "bad.json"));
    rmSync(join(dir, "bad.json"), { force: true });
    await expect(bad.getDeferred(1)).resolves.toEqual(new Set());
  });
});