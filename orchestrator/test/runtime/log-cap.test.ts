import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { capLogFile } from "../../src/runtime/log-cap.js";

const roots: string[] = [];

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function bigLog(path: string, lines: number): void {
  const body: string[] = [];
  for (let i = 0; i < lines; i++) body.push(`行${i} ${"x".repeat(200)}`);
  writeFileSync(path, body.join("\n") + "\n", "utf8");
}

describe("capLogFile", () => {
  it("未超上限 → 一个字节不动", () => {
    const dir = temp("kp-logcap-small-");
    const path = join(dir, "a.log");
    writeFileSync(path, "第一行\n第二行\n", "utf8");
    const before = readFileSync(path, "utf8");
    const out = capLogFile(path, { maxBytes: 1024 * 1024, keepBytes: 1024 });
    expect(out.capped).toBe(false);
    expect(out.droppedBytes).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("路径不存在 → 不抛错、返回未截断", () => {
    const dir = temp("kp-logcap-missing-");
    const out = capLogFile(join(dir, "nope.log"), { maxBytes: 10, keepBytes: 5 });
    expect(out.capped).toBe(false);
    expect(out.droppedBytes).toBe(0);
  });

  it("超上限 → 保尾去头、留完整行、inode 不变、体积降下来", () => {
    const dir = temp("kp-logcap-big-");
    const path = join(dir, "b.log");
    bigLog(path, 5000);
    const sizeBefore = statSync(path).size;
    const inodeBefore = statSync(path).ino;
    expect(sizeBefore).toBeGreaterThan(200 * 1024);

    const out = capLogFile(path, { maxBytes: 100 * 1024, keepBytes: 20 * 1024 });

    expect(out.capped).toBe(true);
    expect(out.droppedBytes).toBeGreaterThan(0);
    expect(out.droppedBytes).toBeLessThan(sizeBefore);

    expect(statSync(path).ino).toBe(inodeBefore);
    expect(statSync(path).size).toBeLessThan(100 * 1024);

    const after = readFileSync(path, "utf8");
    const lines = after.split("\n").filter((line) => line.length > 0);
    expect(lines[0]?.startsWith("[log-cap]")).toBe(true);
    expect(lines[0]).toContain(String(out.droppedBytes));
    expect(after).toContain("行4999");
    expect(after).not.toContain("行0 ");
    expect(lines[1]?.startsWith("行")).toBe(true);
  });

  it("刚截断过 → 再调一次返回未截断", () => {
    const dir = temp("kp-logcap-twice-");
    const path = join(dir, "c.log");
    bigLog(path, 5000);
    expect(capLogFile(path, { maxBytes: 100 * 1024, keepBytes: 20 * 1024 }).capped).toBe(true);
    const second = capLogFile(path, { maxBytes: 100 * 1024, keepBytes: 20 * 1024 });
    expect(second.capped).toBe(false);
    expect(second.droppedBytes).toBe(0);
  });
});