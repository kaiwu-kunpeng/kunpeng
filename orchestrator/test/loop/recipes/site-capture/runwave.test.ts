import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSeenIds,
  readSiteCaptureConfig,
  runSiteCaptureWave,
  writeSeenIds,
} from "../../../../src/loop/recipes/site-capture/runwave.js";
import type { Capture } from "../../../../src/knowledge/capture-store.js";
import type { LoopDef } from "../../../../src/loop/types.js";
import { recipeRegistry } from "../../../../src/loop/recipe.js";
import "../../../../src/loop/site-capture.js";

const LIST_A = `<ul>
  <li><a href="/n/2.html">甲机构关于调整参观预约规则的公告</a><span>2026-09-02</span></li>
  <li><a href="/n/1.html">甲机构关于暂停开放的公告</a><span>2026-09-01</span></li>
</ul>`;
const LIST_B = `<ul><li><a href="./t9.html">乙机构关于外国人住宿登记的通告</a><em>2026-08-30</em></li></ul>`;

function loop(): LoopDef {
  return {
    id: "sn-loop", name: "官网公告采集", projectId: "proj1", recipe: "site-capture",
    metric: { key: "captured", label: "入库数", current: 3 },
    levers: [], waves: [], createdAt: 0, updatedAt: 0,
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kp-sn-"));
  mkdirSync(join(root, ".kunpeng", "site-capture"), { recursive: true });
  writeFileSync(
    join(root, ".kunpeng", "site-capture", "config.json"),
    JSON.stringify({
      targets: [
        { name: "甲机构", listUrl: "https://a.example.gov.cn/n/index.html" },
        { name: "乙机构", listUrl: "https://b.example.gov.cn/tzgg/index.html" },
      ],
      maxNoticesPerWave: 20,
      maxPerTarget: 10,
    }),
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fetchFor(pages: Record<string, string>): (url: string) => Promise<string> {
  return async (url) => {
    const page = pages[url];
    if (page === undefined) throw new Error(`HTTP 403 ${url}`);
    return page;
  };
}

describe("site-capture · 波次执行", () => {
  it("recipe 已注册到 recipeRegistry", () => {
    expect(recipeRegistry["site-capture"]?.id).toBe("site-capture");
    expect(typeof recipeRegistry["site-capture"]?.runWave).toBe("function");
  });

  it("配置解析：默认值与格式错误", () => {
    const cfg = readSiteCaptureConfig(root);
    expect(cfg.targets).toHaveLength(2);
    expect(cfg.maxNoticesPerWave).toBe(20);
    expect(cfg.maxPerTarget).toBe(10);
    expect(cfg.userAgent).toContain("Mozilla");
    writeFileSync(join(root, ".kunpeng", "site-capture", "config.json"), JSON.stringify({ targets: [{ name: "x" }] }));
    expect(() => readSiteCaptureConfig(root)).toThrow(/格式错误/);
  });

  it("抓两个机构→落库 3 条 site-notice capture,写 seen 与 report,metric 累加", async () => {
    const captures: Capture[] = [];
    const res = await runSiteCaptureWave(loop(), "site-sweep", undefined, {
      repoPath: root,
      fetchText: fetchFor({
        "https://a.example.gov.cn/n/index.html": LIST_A,
        "https://b.example.gov.cn/tzgg/index.html": LIST_B,
      }),
      appendCapture: async (c: Capture) => { captures.push(c); return true; },
      now: 1_700_000_000_000,
    });
    expect(res.verified).toBe(true);
    expect(res.metricBefore).toBe(3);
    expect(res.metricDelta).toBe(3);
    expect(res.metricAfter).toBe(6);
    expect(res.detail).toBe("新增 3／抓取 3（错 0/2）");
    expect(res.gotchas?.[0]).toBe("「甲机构关于调整参观预约规则的公告」甲机构");

    expect(captures).toHaveLength(3);
    const first = captures[0]!;
    expect(first.id.startsWith("sn-")).toBe(true);
    expect(first.kind).toBe("site-notice");
    expect(first.source).toBe("url");
    expect(first.raw).toBe("https://a.example.gov.cn/n/2.html");
    expect(first.title).toBe("甲机构关于调整参观预约规则的公告");
    expect(first.tags).toEqual(["site", "甲机构"]);
    expect(first.summary).toContain("2026-09-02");
    expect(first.projectId).toBe("proj1");
    expect(captures[2]!.raw).toBe("https://b.example.gov.cn/tzgg/t9.html");

    expect(readSeenIds(root).size).toBe(3);
    const reports = readdirSync(join(root, ".kunpeng", "site-capture")).filter((f) => f.startsWith("report-"));
    expect(reports).toHaveLength(1);
    const report = JSON.parse(readFileSync(join(root, ".kunpeng", "site-capture", reports[0]!), "utf8")) as { summary: { newCount: number } };
    expect(report.summary.newCount).toBe(3);
  });

  it("第二波同样的页面 0 新增(seen 去重生效),单机构失败只记 error 且整波仍 verified", async () => {
    const pages = {
      "https://a.example.gov.cn/n/index.html": LIST_A,
      "https://b.example.gov.cn/tzgg/index.html": LIST_B,
    };
    await runSiteCaptureWave(loop(), "site-sweep", undefined, {
      repoPath: root, fetchText: fetchFor(pages), appendCapture: async () => true, now: 1_700_000_000_000,
    });
    const captures: Capture[] = [];
    const res = await runSiteCaptureWave(loop(), "site-sweep", undefined, {
      repoPath: root,
      fetchText: fetchFor({ "https://a.example.gov.cn/n/index.html": LIST_A }),
      appendCapture: async (c: Capture) => { captures.push(c); return true; },
      now: 1_700_000_001_000,
    });
    expect(captures).toHaveLength(0);
    expect(res.metricDelta).toBe(0);
    expect(res.verified).toBe(true);
    expect(res.detail).toBe("新增 0／抓取 2（错 1/2）");
  });

  it("全部机构失败→verified=false;配置缺失→verified=false 且 detail 说明", async () => {
    const res = await runSiteCaptureWave(loop(), "site-sweep", undefined, {
      repoPath: root, fetchText: fetchFor({}), appendCapture: async () => true, now: 1,
    });
    expect(res.verified).toBe(false);
    rmSync(join(root, ".kunpeng", "site-capture", "config.json"));
    const missing = await runSiteCaptureWave(loop(), "site-sweep", undefined, { repoPath: root, now: 1 });
    expect(missing.verified).toBe(false);
    expect(missing.detail).toContain("配置缺失");
    expect(existsSync(join(root, ".kunpeng", "site-capture", "seen.json"))).toBe(true);
  });

  it("maxPerTarget 与 maxNoticesPerWave 同时限流", async () => {
    writeFileSync(
      join(root, ".kunpeng", "site-capture", "config.json"),
      JSON.stringify({ targets: [{ name: "甲机构", listUrl: "https://a.example.gov.cn/n/index.html" }], maxNoticesPerWave: 5, maxPerTarget: 1 }),
    );
    const captures: Capture[] = [];
    const res = await runSiteCaptureWave(loop(), "site-sweep", undefined, {
      repoPath: root,
      fetchText: fetchFor({ "https://a.example.gov.cn/n/index.html": LIST_A }),
      appendCapture: async (c: Capture) => { captures.push(c); return true; },
      now: 1,
    });
    expect(captures).toHaveLength(1);
    expect(res.detail).toBe("新增 1／抓取 2（错 0/1）");
    writeSeenIds(root, ["x", "x", "y"]);
    expect([...readSeenIds(root)]).toEqual(["x", "y"]);
  });
});