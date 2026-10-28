import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../../src/util/atomic-write.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-atomic-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("writeFileAtomic", () => {
  it("基本写入可读回，父目录自动创建", async () => {
    const p = join(dir, "deep", "nested", "state.json");
    await writeFileAtomic(p, '{"a":1}');
    expect(readFileSync(p, "utf8")).toBe('{"a":1}');
  });
  it("成功后无 .tmp 残留", async () => {
    const p = join(dir, "s.json");
    await writeFileAtomic(p, "x");
    await writeFileAtomic(p, "y");
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"));
    expect(leftovers).toHaveLength(0);
    expect(readFileSync(p, "utf8")).toBe("y");
  });
  it("并发 10 次写同一文件：无半截内容，结果是其中一个完整值", async () => {
    const p = join(dir, "c.json");
    const values = Array.from({ length: 10 }, (_, i) => JSON.stringify({ v: i, pad: "z".repeat(500) }));
    await Promise.all(values.map((v) => writeFileAtomic(p, v)));
    const got = readFileSync(p, "utf8");
    expect(values.includes(got)).toBe(true);
  });
  it("mode 传入生效", async () => {
    const p = join(dir, "secret.json");
    await writeFileAtomic(p, "s", { mode: 0o600 });
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });
});