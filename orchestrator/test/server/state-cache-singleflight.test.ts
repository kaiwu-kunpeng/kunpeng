import { describe, it, expect } from "vitest";
import { cachedAsync, type CacheEntry } from "../../src/server/state-cache.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("cachedAsync single-flight", () => {
  it("dedupes concurrent produce for the same key", async () => {
    const store = new Map<string, CacheEntry<number>>();
    let calls = 0;
    const d = deferred<number>();
    const produce = () => { calls++; return d.promise; };
    const p1 = cachedAsync(store, "k", 1000, 100, produce);
    const p2 = cachedAsync(store, "k", 1000, 100, produce);
    const p3 = cachedAsync(store, "k", 1000, 100, produce);
    d.resolve(42);
    const [a, b, c] = await Promise.all([p1, p2, p3]);
    expect(calls).toBe(1);
    expect([a, b, c]).toEqual([42, 42, 42]);
  });

  it("evicts in-flight on rejection so the next call retries (no poisoned cache)", async () => {
    const store = new Map<string, CacheEntry<number>>();
    let calls = 0;
    const produce = () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("boom")) : Promise.resolve(7);
    };
    await expect(cachedAsync(store, "k", 1000, 100, produce)).rejects.toThrow("boom");
    const v = await cachedAsync(store, "k", 1000, 100, produce);
    expect(v).toBe(7);
    expect(calls).toBe(2);
  });

  it("different keys do not share a flight", async () => {
    const store = new Map<string, CacheEntry<number>>();
    let calls = 0;
    const d = deferred<number>();
    const produce = () => { calls++; return d.promise; };
    const pa = cachedAsync(store, "a", 1000, 100, produce);
    const pb = cachedAsync(store, "b", 1000, 100, produce);
    d.resolve(1);
    await Promise.all([pa, pb]);
    expect(calls).toBe(2);
  });

  it("returns a fresh cached entry without producing (TTL preserved)", async () => {
    const store = new Map<string, CacheEntry<number>>();
    store.set("k", { at: 100, value: 99 });
    let calls = 0;
    const v = await cachedAsync(store, "k", 1000, 200, () => { calls++; return Promise.resolve(0); });
    expect(v).toBe(99);
    expect(calls).toBe(0);
  });

  it("a settled flight populates the cache so the next in-TTL call is a hit", async () => {
    const store = new Map<string, CacheEntry<number>>();
    let calls = 0;
    const produce = () => { calls++; return Promise.resolve(5); };
    await cachedAsync(store, "k", 1000, 100, produce);
    const v = await cachedAsync(store, "k", 1000, 200, produce);
    expect(v).toBe(5);
    expect(calls).toBe(1);
  });
});