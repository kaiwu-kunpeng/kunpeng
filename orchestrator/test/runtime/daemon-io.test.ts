import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realDaemonIo } from "../../src/runtime/daemon-schedule.js";

describe("B5b-0:realDaemonIo 真实 io", () => {
  it("五个操作齐备且在 tmp 目录内真实可用", async () => {
    const io = realDaemonIo();
    expect(io.homedir().length > 0).toBe(true);
    const base = mkdtempSync(join(tmpdir(), "kp-daemon-io-"));
    const dir = join(base, "a", "b");
    await io.mkdirp(dir);
    const file = join(dir, "x.txt");
    await io.writeFile(file, "内容");
    expect(readFileSync(file, "utf8")).toBe("内容");
    await io.rm(file);
    expect(existsSync(file)).toBe(false);
    await io.rm(file);
  });

  it("exec 同步执行,失败即抛", () => {
    const io = realDaemonIo();
    io.exec(process.execPath, ["-e", "process.exit(0)"]);
    expect(() => io.exec(process.execPath, ["-e", "process.exit(3)"])).toThrow();
  });
});