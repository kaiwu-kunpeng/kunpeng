import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureStore, newCapture } from "../../src/knowledge/capture-store.js";

const deps = (seed: { n: number }) => ({ now: () => 1719900000000 + seed.n, id: () => `cap-test-${seed.n++}` });
const LONG = "这是一段足够长的正文内容，用来触发内容级去重护栏。".repeat(6);

async function makeStore(): Promise<CaptureStore> {
  const dir = await mkdtemp(join(tmpdir(), "cap-dedup-"));
  return new CaptureStore(dir, undefined, null);
}

describe("内容级去重", () => {
  it("同 kind 同正文第二次入库被拒（不同 id）", async () => {
    const store = await makeStore();
    const seed = { n: 0 };
    const first = await store.appendCapture(newCapture({ source: "text", kind: "note", raw: LONG }, deps(seed)));
    const second = await store.appendCapture(newCapture({ source: "text", kind: "note", raw: LONG }, deps(seed)));
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("不同正文正常入库；不同 kind 同正文不互相挡", async () => {
    const store = await makeStore();
    const seed = { n: 0 };
    expect(await store.appendCapture(newCapture({ source: "text", kind: "note", raw: LONG }, deps(seed)))).toBe(true);
    expect(await store.appendCapture(newCapture({ source: "text", kind: "note", raw: `${LONG}后缀不同` }, deps(seed)))).toBe(true);
    expect(await store.appendCapture(newCapture({ source: "text", kind: "another", raw: LONG }, deps(seed)))).toBe(true);
  });

  it("短正文（<120 字符）不去重——每日状态行合法重复", async () => {
    const store = await makeStore();
    const seed = { n: 0 };
    const short = "双维裁决｜A不退化∧B改进=真进步";
    expect(await store.appendCapture(newCapture({ source: "text", kind: "self-evo-fitness", raw: short }, deps(seed)))).toBe(true);
    expect(await store.appendCapture(newCapture({ source: "text", kind: "self-evo-fitness", raw: short }, deps(seed)))).toBe(true);
  });

  it("删除后索引释放，同内容可再入库", async () => {
    const store = await makeStore();
    const seed = { n: 0 };
    const cap = newCapture({ source: "text", kind: "note", raw: LONG }, deps(seed));
    await store.appendCapture(cap);
    expect(await store.deleteCapture(cap.id)).toBe(true);
    expect(await store.appendCapture(newCapture({ source: "text", kind: "note", raw: LONG }, deps(seed)))).toBe(true);
  });
});