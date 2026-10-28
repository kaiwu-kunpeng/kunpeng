import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWechatCaptureWave, readSeenIds } from "../../../../src/loop/recipes/wechat-capture/runwave.js";
import type { Capture } from "../../../../src/knowledge/capture-store.js";
import type { LoopDef } from "../../../../src/loop/types.js";

// Real payload shape captured 2026-07-12 from a self-hosted
// wechat-article-exporter open API (/api/public/v1/article).
const OPEN_API_RESPONSE = JSON.stringify({
  base_resp: { err_msg: "ok", ret: 0 },
  articles: [
    {
      aid: "2651357747_1",
      title: "来江西，共赴八大山人笔下的艺术世界！",
      link: "https://mp.weixin.qq.com/s/0Y3eUXFVzCM3bMsTkhz9rA",
      digest: "特展开幕",
      author_name: "",
      create_time: 1783674660,
      is_deleted: false,
    },
    {
      aid: "2651357747_2",
      title: "来上海，共赏故宫织绣服饰之美！",
      link: "https://mp.weixin.qq.com/s/_KWGNqPlB1ak9FOlGl4rDg",
      digest: "服饰展开幕",
      author_name: "故宫博物院",
      create_time: 1783674660,
      is_deleted: false,
    },
    {
      aid: "9999999_1",
      title: "已删除",
      link: "https://mp.weixin.qq.com/s/deleted-x",
      is_deleted: true,
      create_time: 1783674660,
    },
  ],
});

function loop(): LoopDef {
  return {
    id: "wc-loop", name: "公众号采集", projectId: "proj1", recipe: "wechat-capture",
    metric: { key: "captured", label: "入库数", current: 0 },
    levers: [], waves: [], createdAt: 0, updatedAt: 0,
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kp-wc-art-"));
  mkdirSync(join(root, ".kunpeng", "wechat-capture"), { recursive: true });
  writeFileSync(
    join(root, ".kunpeng", "wechat-capture", "config.json"),
    JSON.stringify({
      exporterBaseUrl: "http://localhost:4000/",
      articleListPath: "/api/public/v1/article?fakeid={fakeid}&begin={begin}",
      authKey: "test-key",
      targets: [{ fakeid: "BIZ1", nickname: "故宫博物院" }],
      pageSize: 5,
      maxArticlesPerWave: 20,
    }),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("runWechatCaptureWave × 开放 API {articles:[]} 真实串线", () => {
  it("抓取→core解析→入库→seen 持久,跳过 is_deleted", async () => {
    const captured: Capture[] = [];
    const headersSeen: (Record<string, string> | undefined)[] = [];
    const res = await runWechatCaptureWave(loop(), "capture", undefined, {
      repoPath: root,
      fetchText: async (_url: string, headers?: Record<string, string>) => {
        headersSeen.push(headers);
        return OPEN_API_RESPONSE;
      },
      appendCapture: async (c: Capture) => { captured.push(c); return true; },
      now: 1783862400000,
      id: (() => { let n = 0; return () => `wc-${n++}`; })(),
    });
    expect(captured.length).toBe(2);
    expect(captured[0].title).toBe("来江西，共赴八大山人笔下的艺术世界！");
    expect(captured[0].kind).toBe("wechat-article");
    expect(captured[0].tags).toContain("故宫博物院");
    expect(headersSeen[0]).toEqual({ "X-Auth-Key": "test-key" });
    expect(res.metricDelta).toBe(2);
    expect(res.verified).toBe(true);
    expect(readSeenIds(root).size).toBe(2);
  });

  it("响应既无 general_msg_list 也无 articles → 空结果不炸", async () => {
    const captured: Capture[] = [];
    const res = await runWechatCaptureWave(loop(), "capture", undefined, {
      repoPath: root,
      fetchText: async () => JSON.stringify({ base_resp: { ret: -1, err_msg: "认证信息无效" } }),
      appendCapture: async (c: Capture) => { captured.push(c); return true; },
      now: 1783862400000,
      id: (() => { let n = 0; return () => `wc-${n++}`; })(),
    });
    expect(captured.length).toBe(0);
    expect(res.metricDelta).toBe(0);
  });
});