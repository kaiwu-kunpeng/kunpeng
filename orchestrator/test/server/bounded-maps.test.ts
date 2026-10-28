import { describe, it, expect } from "vitest";
import { evictOldest } from "../../src/server/workspace-endpoints.js";

describe("evictOldest — FIFO 有界 Map", () => {
  it("超限淘汰最早插入的条目,保留最近的", () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 5; i++) m.set("k" + i, i);
    const evicted = evictOldest(m, 3);
    expect(evicted).toEqual(["k0", "k1"]);
    expect([...m.keys()]).toEqual(["k2", "k3", "k4"]);
  });

  it("未超限不淘汰", () => {
    const m = new Map<string, number>([["a", 1], ["b", 2]]);
    expect(evictOldest(m, 5)).toEqual([]);
    expect(m.size).toBe(2);
  });

  it("onEvict 收到被淘汰的 key 与 value(用于删盘文件)", () => {
    const m = new Map<string, { path: string }>();
    m.set("old", { path: "/tmp/old" });
    m.set("new", { path: "/tmp/new" });
    const seen: Array<[string, string]> = [];
    evictOldest(m, 1, (k, v) => seen.push([k, v.path]));
    expect(seen).toEqual([["old", "/tmp/old"]]);
    expect([...m.keys()]).toEqual(["new"]);
  });

  it("max 为 0 全清", () => {
    const m = new Map<string, number>([["a", 1], ["b", 2]]);
    expect(evictOldest(m, 0)).toEqual(["a", "b"]);
    expect(m.size).toBe(0);
  });
});