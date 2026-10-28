import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRESENCE_KEEP_DAYS,
  archiveStalePresence,
  classifyPresenceForArchive,
} from "../../src/switchboard/presence-archive.js";

const DAY = 86_400_000;
const roots: string[] = [];

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function beat(dir: string, name: string, ts: number): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ instance: name, ts }), "utf8");
}

describe("classifyPresenceForArchive", () => {
  const now = 1_700_000_000_000;

  it("保留窗口默认 7 天", () => {
    expect(PRESENCE_KEEP_DAYS).toBe(7);
  });

  it("新的保留、旧的归档", () => {
    const out = classifyPresenceForArchive([
      { file: "fresh.json", ts: now - 1 * DAY },
      { file: "edge.json", ts: now - 7 * DAY + 1000 },
      { file: "old.json", ts: now - 30 * DAY },
    ], now);
    expect(out.keep.sort()).toEqual(["edge.json", "fresh.json"]);
    expect(out.archive).toEqual(["old.json"]);
    expect(out.unclassified).toEqual([]);
  });

  it("ts 缺失或非法一律不分类、永不归档", () => {
    const out = classifyPresenceForArchive([
      { file: "a.json" },
      { file: "b.json", ts: Number.NaN },
      { file: "c.json", ts: now - 99 * DAY },
    ], now);
    expect(out.unclassified.sort()).toEqual(["a.json", "b.json"]);
    expect(out.archive).toEqual(["c.json"]);
  });

  it("nowMs 非法时一个都不归档", () => {
    const out = classifyPresenceForArchive([{ file: "old.json", ts: 1 }], Number.NaN);
    expect(out.archive).toEqual([]);
    expect(out.keep).toEqual(["old.json"]);
  });

  it("输出按文件名升序,确定", () => {
    const out = classifyPresenceForArchive([
      { file: "z.json", ts: now - 30 * DAY },
      { file: "a.json", ts: now - 30 * DAY },
    ], now);
    expect(out.archive).toEqual(["a.json", "z.json"]);
  });
});

describe("archiveStalePresence 只移动不删除", () => {
  const now = 1_700_000_000_000;

  it("旧的进归档、新的留下、坏文件与非 json 原地不动,总数不变", async () => {
    const root = temp("kp-parch-");
    const presenceDir = join(root, "presence");
    const archiveRoot = join(root, "presence-archive");
    beat(presenceDir, "old-1", now - 10 * DAY);
    beat(presenceDir, "old-2", now - 20 * DAY);
    beat(presenceDir, "old-3", now - 40 * DAY);
    beat(presenceDir, "new-1", now - 1 * DAY);
    beat(presenceDir, "new-2", now - 2 * DAY);
    writeFileSync(join(presenceDir, "broken.json"), "{ not json", "utf8");
    writeFileSync(join(presenceDir, "note.txt"), "不是 json", "utf8");

    const before = readdirSync(presenceDir).length;
    const r = await archiveStalePresence({ presenceDir, archiveRoot, nowMs: now, dateLabel: "2026-08-08" });

    expect(r.archived).toBe(3);
    expect(r.kept).toBe(2);
    const archived = readdirSync(r.archiveDir).sort();
    expect(archived).toEqual(["old-1.json", "old-2.json", "old-3.json"]);

    const left = readdirSync(presenceDir).sort();
    expect(left).toEqual(["broken.json", "new-1.json", "new-2.json", "note.txt"]);
    expect(left.length + archived.length).toBe(before);
    expect(readFileSync(join(presenceDir, "note.txt"), "utf8")).toBe("不是 json");
  });

  it("幂等:再跑一次归档 0 个", async () => {
    const root = temp("kp-parch-idem-");
    const presenceDir = join(root, "presence");
    const archiveRoot = join(root, "presence-archive");
    beat(presenceDir, "old-1", now - 10 * DAY);
    const first = await archiveStalePresence({ presenceDir, archiveRoot, nowMs: now, dateLabel: "2026-08-08" });
    expect(first.archived).toBe(1);
    const second = await archiveStalePresence({ presenceDir, archiveRoot, nowMs: now, dateLabel: "2026-08-08" });
    expect(second.archived).toBe(0);
  });

  it("目标已存在同名文件时不覆盖,源文件留在原处", async () => {
    const root = temp("kp-parch-clash-");
    const presenceDir = join(root, "presence");
    const archiveRoot = join(root, "presence-archive");
    beat(presenceDir, "dup", now - 10 * DAY);
    const target = join(archiveRoot, "2026-08-08");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "dup.json"), "先来的", "utf8");

    const r = await archiveStalePresence({ presenceDir, archiveRoot, nowMs: now, dateLabel: "2026-08-08" });
    expect(r.archived).toBe(0);
    expect(existsSync(join(presenceDir, "dup.json"))).toBe(true);
    expect(readFileSync(join(target, "dup.json"), "utf8")).toBe("先来的");
  });

  it("presenceDir 不存在时不抛错", async () => {
    const root = temp("kp-parch-missing-");
    const r = await archiveStalePresence({
      presenceDir: join(root, "nope"),
      archiveRoot: join(root, "arch"),
      nowMs: now,
      dateLabel: "2026-08-08",
    });
    expect(r.archived).toBe(0);
    expect(r.kept).toBe(0);
  });
});

describe("源码里不许有删除动作", () => {
  it("presence-archive.ts 不含 unlink / rmSync / rmdir", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../src/switchboard/presence-archive.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/\bunlink\b/);
    expect(source).not.toMatch(/\brmSync\b/);
    expect(source).not.toMatch(/\brmdir\b/);
  });
});