import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { siteFromHost, handleDrainPayload, ensureCrawlerTable } from "./collector.js";
import type { SqlRunner } from "./store.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteFromHost", () => {
  test("按 host 子串映射站点", () => {
    const siteMap = {
      "acme-shop": ["acme-shop"],
      "demo-travel": ["demo-travel"],
    };
    expect(siteFromHost("www.acme-shop.example", siteMap)).toBe("acme-shop");
    expect(siteFromHost("www.demo-travel.example", siteMap)).toBe("demo-travel");
    expect(siteFromHost("example.com", siteMap)).toBe("example.com");
    expect(siteFromHost(null, siteMap)).toBe("unknown");
    expect(siteFromHost("", siteMap)).toBe("unknown");
  });
});

function fakeRunner(): { runner: SqlRunner; queries: string[] } {
  const queries: string[] = [];
  const runner = { query: async (sql: string) => { queries.push(sql); return [] as unknown[]; } } as unknown as SqlRunner;
  return { runner, queries };
}

describe("ensureCrawlerTable", () => {
  test("把 DDL 按 ; 拆成多条逐条跑（含 create table 与 create index）", async () => {
    const { runner, queries } = fakeRunner();
    await ensureCrawlerTable(runner);
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.join("\n").toLowerCase()).toContain("create table");
    expect(queries.join("\n").toLowerCase()).toContain("create index");
  });
});

describe("handleDrainPayload", () => {
  test("解析 JSON 数组 → 按 host 分站 → 记录 AI 爬虫命中（非 AI UA 跳过）", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "kp-crawler-test-"));
    writeFileSync(
      join(stateDir, "crawler-sites.json"),
      JSON.stringify({
        "acme-shop": ["acme-shop"],
        "demo-travel": ["demo-travel"],
      }),
    );
    vi.stubEnv("KUNPENG_STATE", stateDir);

    const inserts: Array<{ sql: string; params?: unknown[] }> = [];
    const runner = {
      query: async (sql: string, params?: unknown[]) => { inserts.push({ sql, params }); return [] as unknown[]; },
    } as unknown as SqlRunner;
    // 注意：parseDrainPayload 从 record.proxy.* 读 ua/host/path/statusCode/timestamp（host 在 proxy 内，非顶层）。
    const payload = JSON.stringify([
      { proxy: { userAgent: ["GPTBot/1.0"], host: "www.acme-shop.example", path: "/products/X", statusCode: 200 } },
      { proxy: { userAgent: ["Mozilla/5.0 Chrome"], host: "www.acme-shop.example", path: "/", statusCode: 200 } },
      { proxy: { userAgent: ["ChatGPT-User/1.0"], host: "www.demo-travel.example", path: "/guide", statusCode: 200 } },
    ]);
    const r = await handleDrainPayload(runner, payload);
    // 2 条 AI 命中（GPTBot+ChatGPT-User），Chrome 被 aiBotFromUA 跳过
    expect(r.recorded).toBe(2);
    const insertSqls = inserts.filter((i) => /insert into ai_crawler_hits/i.test(i.sql));
    expect(insertSqls.length).toBe(2);
    const sites = insertSqls.map((i) => (i.params as unknown[])[0]);
    expect(sites).toContain("acme-shop");
    expect(sites).toContain("demo-travel");
  });

  test("空/垃圾 body → recorded 0，不抛", async () => {
    const { runner } = fakeRunner();
    const r = await handleDrainPayload(runner, "not json at all");
    expect(r.recorded).toBe(0);
  });
});
