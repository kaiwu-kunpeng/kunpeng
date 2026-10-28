import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_CONCURRENT_FLOWS, acquireFlowSlot, resolveMaxConcurrentFlows, slotsDir } from "../../src/runtime/concurrency-slots.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-slots-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("跨进程流槽位（作者锁定）", () => {
  it("上限解析：env > budget.json > 缺省 4", () => {
    expect(DEFAULT_MAX_CONCURRENT_FLOWS).toBe(4);
    expect(resolveMaxConcurrentFlows({})).toBe(4);
    expect(resolveMaxConcurrentFlows({}, { maxConcurrent: 2 })).toBe(2);
    expect(resolveMaxConcurrentFlows({ KUNPENG_MAX_CONCURRENT_FLOWS: "6" }, { maxConcurrent: 2 })).toBe(6);
    expect(resolveMaxConcurrentFlows({ KUNPENG_MAX_CONCURRENT_FLOWS: "0" })).toBe(4);
    expect(resolveMaxConcurrentFlows({ KUNPENG_MAX_CONCURRENT_FLOWS: "x" })).toBe(4);
    expect(slotsDir(dir)).toBe(join(dir, "locks", "slots"));
  });

  it("max=2：两把可取，第三把等到超时抛错；释放后立刻可取", async () => {
    const a = await acquireFlowSlot(dir, { max: 2, pollMs: 10, timeoutMs: 150 });
    const b = await acquireFlowSlot(dir, { max: 2, pollMs: 10, timeoutMs: 150 });
    expect(readdirSync(slotsDir(dir)).sort()).toEqual(["0", "1"]);
    await expect(acquireFlowSlot(dir, { max: 2, pollMs: 10, timeoutMs: 150, log: () => {} })).rejects.toThrow(/并发上限 2/);
    await a();
    const c = await acquireFlowSlot(dir, { max: 2, pollMs: 10, timeoutMs: 150 });
    expect(readdirSync(slotsDir(dir)).length).toBe(2);
    await b(); await c(); await c();
    expect(readdirSync(slotsDir(dir)).length).toBe(0);
  });

  it("死进程/过期的槽位被回收", async () => {
    mkdirSync(join(slotsDir(dir), "0"), { recursive: true });
    writeFileSync(join(slotsDir(dir), "0", "owner.json"), JSON.stringify({ pid: 999_999, at: Date.now() }), "utf8");
    const release = await acquireFlowSlot(dir, { max: 1, pollMs: 10, timeoutMs: 200 });
    expect(existsSync(join(slotsDir(dir), "0", "owner.json"))).toBe(true);
    await release();
    mkdirSync(join(slotsDir(dir), "0"), { recursive: true });
    writeFileSync(join(slotsDir(dir), "0", "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now() - 7 * 3_600_000 }), "utf8");
    const release2 = await acquireFlowSlot(dir, { max: 1, pollMs: 10, timeoutMs: 200 });
    await release2();
    expect(readdirSync(slotsDir(dir)).length).toBe(0);
  });

  it("max<=0 视为不限：不建目录", async () => {
    const release = await acquireFlowSlot(dir, { max: 0 });
    expect(existsSync(slotsDir(dir))).toBe(false);
    await release();
  });
});