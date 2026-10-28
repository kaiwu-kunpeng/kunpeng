import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { trimLogDir, trimLogFile } from "../../src/runtime/log-trim.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-logtrim-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line-${String(i).padStart(5, "0")} ${"x".repeat(40)}`).join("\n") + "\n";
const NOW = () => new Date("2026-09-24T00:00:00Z");

describe("日志原地保尾截断（作者锁定）", () => {
  test("未超阈值不动", () => {
    const p = join(dir, "a.log");
    writeFileSync(p, lines(10));
    const before = readFileSync(p, "utf8");
    expect(trimLogFile(p, { maxBytes: 10_000, keepBytes: 1_000 })).toEqual({ file: p, trimmed: false, before: before.length, after: before.length });
    expect(readFileSync(p, "utf8")).toBe(before);
  });

  test("超阈值：inode 不变、只留末尾整行、带截断说明、末行保留", () => {
    const p = join(dir, "serve.log");
    writeFileSync(p, lines(2000));
    const ino = statSync(p).ino;
    const out = trimLogFile(p, { maxBytes: 20_000, keepBytes: 5_000, now: NOW });
    expect(out.trimmed).toBe(true);
    expect(statSync(p).ino).toBe(ino);
    const text = readFileSync(p, "utf8");
    expect(statSync(p).size).toBe(out.after);
    expect(out.after).toBeLessThanOrEqual(5_000 + 200);
    const [header, first] = text.split("\n");
    expect(header).toContain("[log-trim] 2026-09-24T00:00:00.000Z");
    expect(first).toMatch(/^line-\d{5} x{40}$/);
    expect(text.trimEnd().split("\n").at(-1)).toBe(`line-01999 ${"x".repeat(40)}`);
  });

  test("截断前就以 append 打开的 fd：截断后写入的行落进同一文件，且没有空洞", () => {
    const p = join(dir, "autopilot.log");
    writeFileSync(p, lines(2000));
    const fd = openSync(p, "a");
    try {
      writeSync(fd, "before-trim\n");
      const out = trimLogFile(p, { maxBytes: 20_000, keepBytes: 5_000, now: NOW });
      writeSync(fd, "after-trim\n");
      const text = readFileSync(p, "utf8");
      expect(text.endsWith("before-trim\nafter-trim\n")).toBe(true);
      expect(statSync(p).size).toBe(out.after + "after-trim\n".length);
      expect(text.includes("\u0000")).toBe(false);
    } finally {
      closeSync(fd);
    }
  });

  test("目录：只截 *.log、跳过目录与非 log、单文件失败不影响其它", () => {
    writeFileSync(join(dir, "big.log"), lines(2000));
    writeFileSync(join(dir, "small.log"), lines(5));
    writeFileSync(join(dir, "big.txt"), lines(2000));
    mkdirSync(join(dir, "sub.log"));
    symlinkSync(join(dir, "missing-target"), join(dir, "broken.log"));
    const out = trimLogDir(dir, { maxBytes: 20_000, keepBytes: 5_000, now: NOW });
    expect(out.map((r) => [r.file.split("/").at(-1), r.trimmed, Boolean(r.error)])).toEqual([
      ["big.log", true, false],
      ["broken.log", false, true],
    ]);
    expect(statSync(join(dir, "big.txt")).size).toBeGreaterThan(20_000);
    expect(trimLogDir(join(dir, "nope"))).toEqual([]);
  });

  test("每日 maintain 接上截断 ~/.kunpeng/logs（源码形状）", () => {
    const src = readFileSync(new URL("../../src/cli-commands/maintain-guardian.ts", import.meta.url), "utf8");
    expect(src).toContain('trimLogDir(join(kunpengStateDir(), "logs"))');
  });
});