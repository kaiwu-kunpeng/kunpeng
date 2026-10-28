import { expect, test } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "../src/runtime/filelock.js";

test("withFileLock 串行化：第二个调用必须等第一个释放，不交错", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kp-lock-"));
  const lock = join(dir, "locks", "x.lock");
  const order: string[] = [];
  const a = withFileLock(lock, async () => {
    order.push("a-start");
    await new Promise((r) => setTimeout(r, 120));
    order.push("a-end");
  }, { pollMs: 15 });
  // 让 a 先抢到锁
  await new Promise((r) => setTimeout(r, 20));
  const b = withFileLock(lock, async () => { order.push("b-start"); order.push("b-end"); }, { pollMs: 15 });
  await Promise.all([a, b]);
  expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  rmSync(dir, { recursive: true, force: true });
});

test("withFileLock 偷死锁：持有者 pid 已死时直接夺锁，不卡死", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kp-lock-"));
  const lock = join(dir, "locks", "y.lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: 999999, at: Date.now() })); // 不存在的 pid
  let ran = false;
  await withFileLock(lock, async () => { ran = true; }, { timeoutMs: 3000, pollMs: 15 });
  expect(ran).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

test("withFileLock 释放：fn 抛错也 finally 释放锁，可再次取得", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kp-lock-"));
  const lock = join(dir, "locks", "z.lock");
  await expect(withFileLock(lock, async () => { throw new Error("boom"); }, { pollMs: 15 })).rejects.toThrow("boom");
  let ran = false;
  await withFileLock(lock, async () => { ran = true; }, { pollMs: 15 });
  expect(ran).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});
