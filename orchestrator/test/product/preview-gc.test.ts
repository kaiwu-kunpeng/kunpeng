import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepStalePreviews } from "../../src/product/preview.js";

function writeInfo(root: string, slug: string, info: Record<string, unknown>) {
  const dir = join(root, ".kunpeng", "product", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "preview.json"), JSON.stringify(info));
}

describe("sweepStalePreviews", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-gc-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("超龄且存活 → 调 kill 并删 preview.json，返回 slug", async () => {
    const now = 10_000_000_000;
    writeInfo(root, "old", { pid: process.pid, port: 1, url: "http://localhost:1", script: "dev", startedAt: now - 5 * 3_600_000 });
    const killed: number[] = [];
    const swept = await sweepStalePreviews(root, { now, kill: (pid) => killed.push(pid) });
    expect(swept).toEqual(["old"]);
    expect(killed).toEqual([process.pid]);
    expect(existsSync(join(root, ".kunpeng", "product", "old", "preview.json"))).toBe(false);
  });

  it("未超龄不动；坏档跳过；缺目录返回空", async () => {
    const now = 10_000_000_000;
    writeInfo(root, "fresh", { pid: process.pid, port: 2, url: "http://localhost:2", script: "dev", startedAt: now - 60_000 });
    const bad = join(root, ".kunpeng", "product", "bad");
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "preview.json"), "{oops");
    const killed: number[] = [];
    expect(await sweepStalePreviews(root, { now, kill: (p) => killed.push(p) })).toEqual([]);
    expect(killed).toEqual([]);
    expect(existsSync(join(root, ".kunpeng", "product", "fresh", "preview.json"))).toBe(true);
    expect(await sweepStalePreviews(mkdtempSync(join(tmpdir(), "kp-empty-")), { now })).toEqual([]);
  });
});