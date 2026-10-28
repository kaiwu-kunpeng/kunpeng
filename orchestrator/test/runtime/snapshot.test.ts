import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotState, pruneSnapshots, dailySnapshotIfDue } from "../../src/runtime/snapshot.js";

const NOW = 1_800_000_000_000;
const DAY = 24 * 3600 * 1000;
let stateDir: string;
let dest: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "kp-snap-state-"));
  dest = mkdtempSync(join(tmpdir(), "kp-snap-dest-"));
  writeFileSync(join(stateDir, "projects.json"), '[{"id":"p1"}]');
  mkdirSync(join(stateDir, "profiles", "home"), { recursive: true });
  writeFileSync(join(stateDir, "profiles", "home", "projects.json"), "[]");
});
afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(dest, { recursive: true, force: true });
});

describe("snapshotState", () => {
  it("拷贝注册表与 profiles 树，目录名带时间戳", async () => {
    const r = await snapshotState(stateDir, NOW, dest);
    expect(r.dir.includes("snapshot-")).toBe(true);
    expect(r.files).toBeGreaterThanOrEqual(2);
    const snapDirs = readdirSync(dest).filter((d) => d.startsWith("snapshot-"));
    expect(snapDirs).toHaveLength(1);
    const copied = readFileSync(join(dest, snapDirs[0], "projects.json"), "utf8");
    expect(copied).toContain("p1");
    expect(existsSync(join(dest, snapDirs[0], "profiles", "home", "projects.json"))).toBe(true);
  });
  it("缺 auth.json 等可选文件不炸", async () => {
    const r = await snapshotState(stateDir, NOW, dest);
    expect(r.files).toBeGreaterThanOrEqual(1);
  });
});

describe("pruneSnapshots", () => {
  it("只保留最新 keep 个", async () => {
    for (let i = 0; i < 5; i++) await snapshotState(stateDir, NOW + i * 60_000, dest);
    const removed = await pruneSnapshots(dest, 3);
    expect(removed).toHaveLength(2);
    const left = readdirSync(dest).filter((d) => d.startsWith("snapshot-"));
    expect(left).toHaveLength(3);
  });
  it("目录不存在返回空", async () => {
    expect(await pruneSnapshots(join(dest, "ghost"), 3)).toHaveLength(0);
  });
});

describe("dailySnapshotIfDue", () => {
  it("首次执行；24h 内跳过；24h 后再执行", async () => {
    const first = await dailySnapshotIfDue(stateDir, NOW, dest);
    expect(first).not.toBeNull();
    expect(await dailySnapshotIfDue(stateDir, NOW + DAY - 1000, dest)).toBeNull();
    const again = await dailySnapshotIfDue(stateDir, NOW + DAY + 1000, dest);
    expect(again).not.toBeNull();
    const snapDirs = readdirSync(dest).filter((d) => d.startsWith("snapshot-"));
    expect(snapDirs).toHaveLength(2);
  });
});