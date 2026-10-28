import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kpBeaconSnippet, appendOpsEvent, readOpsSummary } from "../../src/product/ops-kit.js";

async function repoWithProduct(slug: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "opskit-"));
  await mkdir(join(root, ".kunpeng", "product", slug), { recursive: true });
  return root;
}

describe("Product Ops Kit v1", () => {
  it("snippet 自包含且带 slug/端点/pageview/error/kpTrack", () => {
    const s = kpBeaconSnippet("demo-app", "http://127.0.0.1:7788", "test-token");
    expect(s).toContain("<script");
    expect(s).toContain("demo-app");
    expect(s).toContain("/api/beacon");
    expect(s).toContain("pageview");
    expect(s).toContain("kpTrack");
    expect(s).toContain("sendBeacon");
  });

  it("append→summary 回环：三类统计与 top3", async () => {
    const root = await repoWithProduct("p1");
    const now = 1000000;
    expect(await appendOpsEvent(root, "p1", { kind: "pageview" }, now - 100)).toBe(true);
    expect(await appendOpsEvent(root, "p1", { kind: "pageview" }, now - 50)).toBe(true);
    expect(await appendOpsEvent(root, "p1", { kind: "error", name: "TypeError" }, now - 40)).toBe(true);
    for (let i = 0; i < 3; i++) await appendOpsEvent(root, "p1", { kind: "event", name: "signup" }, now - 30 + i);
    await appendOpsEvent(root, "p1", { kind: "event", name: "click" }, now - 10);
    const sum = await readOpsSummary(root, "p1", { now });
    expect(sum?.pageviews).toBe(2);
    expect(sum?.errors).toBe(1);
    expect(sum?.topEvents[0]).toEqual({ name: "signup", count: 3 });
  });

  it("时间窗过滤：窗外事件不计", async () => {
    const root = await repoWithProduct("p2");
    const now = 10 * 86400000;
    await appendOpsEvent(root, "p2", { kind: "pageview" }, now - 8 * 86400000);
    await appendOpsEvent(root, "p2", { kind: "pageview" }, now - 100);
    const sum = await readOpsSummary(root, "p2", { now });
    expect(sum?.pageviews).toBe(1);
  });

  it("fail-safe：非法 kind/不存在的产品拒收不抛；无文件 summary=undefined", async () => {
    const root = await repoWithProduct("p3");
    expect(await appendOpsEvent(root, "p3", { kind: "hack" }, 1)).toBe(false);
    expect(await appendOpsEvent(root, "nope", { kind: "pageview" }, 1)).toBe(false);
    expect(await readOpsSummary(root, "nope", { now: 1 })).toBeUndefined();
  });
});
