import { expect, test } from "vitest";
import { cachedAsync, type CacheEntry } from "../../src/server/state-cache.js";

test("TTL 内命中:produce 只调一次,返回缓存值", async () => {
  const store = new Map<string, CacheEntry<number>>();
  let calls = 0;
  const produce = async () => { calls++; return 42; };
  expect(await cachedAsync(store, "k", 1000, 100, produce)).toBe(42);
  expect(await cachedAsync(store, "k", 1000, 600, produce)).toBe(42); // diff 500 < 1000 → 命中
  expect(calls).toBe(1);
});

test("超过 TTL → 重新 produce", async () => {
  const store = new Map<string, CacheEntry<number>>();
  let calls = 0;
  const produce = async () => { calls++; return calls; };
  expect(await cachedAsync(store, "k", 1000, 0, produce)).toBe(1);
  expect(await cachedAsync(store, "k", 1000, 1500, produce)).toBe(2); // diff 1500 >= 1000 → 未命中
  expect(calls).toBe(2);
});

test("不同 key 互相独立", async () => {
  const store = new Map<string, CacheEntry<string>>();
  const a = await cachedAsync(store, "a", 1000, 0, async () => "A");
  const b = await cachedAsync(store, "b", 1000, 0, async () => "B");
  expect([a, b]).toEqual(["A", "B"]);
});

test("ttlMs<=0 永远未命中(每次都 produce)", async () => {
  const store = new Map<string, CacheEntry<number>>();
  let calls = 0;
  const produce = async () => { calls++; return calls; };
  await cachedAsync(store, "k", 0, 100, produce);
  await cachedAsync(store, "k", 0, 100, produce);
  expect(calls).toBe(2);
});

test("缓存值为 undefined 也算命中(基于 entry 存在,不重复 produce)", async () => {
  const store = new Map<string, CacheEntry<number | undefined>>();
  let calls = 0;
  const produce = async () => { calls++; return undefined; };
  await cachedAsync(store, "k", 1000, 0, produce);
  await cachedAsync(store, "k", 1000, 500, produce);
  expect(calls).toBe(1);
});