import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSeoInternalLinksWave } from "../../src/loop/recipes/seo-internal-links/runwave.js";
import { snapshotPath, type InternalLinksSnapshot } from "../../src/loop/recipes/seo-internal-links/core.js";
import { recipeRegistry } from "../../src/loop/recipe.js";
import type { LoopDef } from "../../src/loop/types.js";
import "../../src/loop/seo-internal-links.js";

const ORIGIN = "https://shop.example";
const html = (links: string[]) => `<html><head><title>t</title></head><body>${links.map((l) => `<a href="${l}">x</a>`).join("")}</body></html>`;
const SITE: Record<string, { status: number; type: string; body: string }> = {
  "/robots.txt": { status: 200, type: "text/plain", body: "User-agent: *\nDisallow:\n" },
  "/sitemap.xml": { status: 200, type: "application/xml", body: `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/a</loc></url><url><loc>${ORIGIN}/ghost</loc></url></urlset>` },
  "/": { status: 200, type: "text/html", body: html(["/a", "/b"]) },
  "/a": { status: 200, type: "text/html", body: html(["/b", "/dead"]) },
  "/b": { status: 200, type: "text/html", body: html([]) },
  "/dead": { status: 404, type: "text/html", body: "gone" },
};
const fakeFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  const hit = SITE[url.pathname] ?? { status: 404, type: "text/plain", body: "" };
  return new Response(hit.body, { status: hit.status, headers: { "content-type": hit.type } });
};
const deadFetch: typeof fetch = async () => new Response("", { status: 0 });

function loop(over: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "pz-links", name: "PZ links", projectId: "proj-a", recipe: "seo-internal-links", autonomous: true, goalId: "goal-pz-links",
    metric: { key: "linkDefects", label: "内链缺陷", current: 9 },
    levers: [], nextLever: { lever: "crawl", target: `${ORIGIN}/` }, waves: [], createdAt: 1, updatedAt: 1, ...over,
  };
}

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-seo-links-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("seo-internal-links 波次（作者锁定）", () => {
  it("配方已注册且不给 lever 时用默认抓手", () => {
    const r = recipeRegistry["seo-internal-links"];
    expect(r).toBeTruthy();
    expect(r!.listLevers(loop()).map((l) => l.id)).toEqual(["crawl", "submit-indexnow"]);
  });

  it("crawl：只读抓取→快照落盘→linkDefects=断链+漏 sitemap→L0、goalMetricCurrent", async () => {
    const stateDir = join(root, ".kunpeng");
    const r = await runSeoInternalLinksWave(loop(), "crawl", `${ORIGIN}/`, { repoRoot: root, stateDir, fetchImpl: fakeFetch, now: () => 777 });
    expect(r.level).toBe("L0");
    expect(r.verified).toBe(true);
    expect(r.metricBefore).toBe(9);
    expect(r.metricAfter).toBe(2);
    expect(r.metricDelta).toBe(-7);
    expect(r.goalMetricCurrent).toBe(2);
    const p = snapshotPath(stateDir, "pz-links");
    expect(r.evidence).toBe(p);
    const s = JSON.parse(readFileSync(p, "utf8")) as InternalLinksSnapshot;
    expect(s.startUrl).toBe(`${ORIGIN}/`);
    expect(s.pageCount).toBe(4);
    expect(s.broken.map((b) => b.to)).toEqual([`${ORIGIN}/dead`]);
    expect(s.notInSitemap).toEqual([`${ORIGIN}/b`]);
    expect(s.orphans).toEqual([`${ORIGIN}/ghost`]);
    expect(s.okUrls).toEqual([`${ORIGIN}/`, `${ORIGIN}/a`, `${ORIGIN}/b`]);
    expect(s.linkDefects).toBe(2);
    expect(s.sitemapStatus).toBe("ok");
    expect(s.at).toBe(777);
  });

  it("crawl 第二轮：metricBefore 取上一份快照；没 target 用快照里的 startUrl", async () => {
    const stateDir = join(root, ".kunpeng");
    await runSeoInternalLinksWave(loop(), "crawl", `${ORIGIN}/`, { repoRoot: root, stateDir, fetchImpl: fakeFetch });
    const r = await runSeoInternalLinksWave(loop(), "crawl", undefined, { repoRoot: root, stateDir, fetchImpl: fakeFetch });
    expect(r.metricBefore).toBe(2);
    expect(r.metricAfter).toBe(2);
    expect(r.metricDelta).toBe(0);
  });

  it("抓不到站（全 status 0）→ 仪器故障、不 verified、不回填目标", async () => {
    const stateDir = join(root, ".kunpeng");
    const r = await runSeoInternalLinksWave(loop(), "crawl", `${ORIGIN}/`, { repoRoot: root, stateDir, fetchImpl: deadFetch });
    expect(r.verified).toBe(false);
    expect(r.instrumentBroken).toBe(true);
    expect(r.goalMetricCurrent).toBeUndefined();
  });

  it("submit-indexnow：前置筛出 notInSitemap 里的 200 html 页→入 outbox→L3 带 outboxId，指标不变", async () => {
    const stateDir = join(root, ".kunpeng");
    await runSeoInternalLinksWave(loop(), "crawl", `${ORIGIN}/`, { repoRoot: root, stateDir, fetchImpl: fakeFetch });
    const enqueue = vi.fn(() => ({ id: "obx-test-1" }));
    const r = await runSeoInternalLinksWave(loop(), "submit-indexnow", undefined, { repoRoot: root, stateDir, fetchImpl: fakeFetch, enqueue });
    expect(enqueue).toHaveBeenCalledWith(root, "indexnow", { urls: [`${ORIGIN}/b`], host: "shop.example" });
    expect(r.level).toBe("L3");
    expect(r.verified).toBe(true);
    expect(r.outboxId).toBe("obx-test-1");
    expect(r.metricDelta).toBe(0);
    expect(r.metricAfter).toBe(2);
    expect(r.goalMetricCurrent).toBeUndefined();
    expect(r.detail).toContain("kunpeng outbox flush indexnow");
    expect(existsSync(join(root, ".kunpeng", "outbox", "indexnow.json"))).toBe(false);
  });

  it("submit-indexnow 没快照先抓；未知 lever 抛错", async () => {
    const stateDir = join(root, ".kunpeng");
    await expect(runSeoInternalLinksWave(loop(), "submit-indexnow", undefined, { repoRoot: root, stateDir, fetchImpl: fakeFetch })).rejects.toThrow(/crawl/);
    await expect(runSeoInternalLinksWave(loop(), "nope", undefined, { repoRoot: root, stateDir, fetchImpl: fakeFetch })).rejects.toThrow(/unsupported/);
  });
});