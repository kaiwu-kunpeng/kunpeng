import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gcUploads } from "../../src/server/workspace-endpoints.js";

describe("上传孤儿 GC(作者验收)", () => {
  it("删超期文件,保留近期文件", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-updgc-"));
    const oldF = join(dir, "old.png");
    const newF = join(dir, "new.png");
    writeFileSync(oldF, "x");
    writeFileSync(newF, "y");
    const tenDaysAgo = Date.now() / 1000 - 10 * 24 * 3600;
    utimesSync(oldF, tenDaysAgo, tenDaysAgo);

    const removed = await gcUploads(dir, 7 * 24 * 60 * 60 * 1000, () => Date.now());
    expect(removed).toBe(1);
    expect(existsSync(oldF)).toBe(false);
    expect(existsSync(newF)).toBe(true);
  });

  it("目录不存在 → 返回 0 不抛", async () => {
    const removed = await gcUploads(join(tmpdir(), "kp-nonexist-" + Math.random().toString(36).slice(2)), 1000, () => Date.now());
    expect(removed).toBe(0);
  });
});