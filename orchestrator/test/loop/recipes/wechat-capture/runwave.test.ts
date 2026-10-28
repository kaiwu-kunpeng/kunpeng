import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runWechatCaptureWave,
  buildArticleListUrl,
  readWechatCaptureConfig,
  readSeenIds,
  writeSeenIds,
} from "../../../../src/loop/recipes/wechat-capture/runwave.js";
import type { Capture } from "../../../../src/knowledge/capture-store.js";
import type { LoopDef } from "../../../../src/loop/types.js";
import { recipeRegistry } from "../../../../src/loop/recipe.js";
import "../../../../src/loop/wechat-capture.js";

const GENERAL = JSON.stringify({
  list: [
    {
      comm_msg_info: { datetime: 1720000000 },
      app_msg_ext_info: {
        title: "文章一",
        content_url: "http://mp.weixin.qq.com/s?mid=100&amp;idx=1",
        del_flag: 0,
        is_multi: 0,
      },
    },
    {
      comm_msg_info: { datetime: 1720000100 },
      app_msg_ext_info: {
        title: "文章二",
        content_url: "http://mp.weixin.qq.com/s?mid=101&amp;idx=1",
        del_flag: 0,
        is_multi: 0,
      },
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
  root = mkdtempSync(join(tmpdir(), "kp-wc-"));
  mkdirSync(join(root, ".kunpeng", "wechat-capture"), { recursive: true });
  writeFileSync(
    join(root, ".kunpeng", "wechat-capture", "config.json"),
    JSON.stringify({
      exporterBaseUrl: "http://localhost:3000/",
      articleListPath: "/api/web/mp/profile_ext_getmsg?id={fakeid}&begin={begin}",
      targets: [{ fakeid: "BIZ1", nickname: "甲号" }],
      pageSize: 5,
      maxArticlesPerWave: 20,
    }),
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("配置与 URL 构造", () => {
  it("buildArticleListUrl 去尾斜杠+模板替换", () => {
    const url = buildArticleListUrl(
      { exporterBaseUrl: "http://h/", articleListPath: "/x?id={fakeid}&b={begin}" },
      "B I Z",
      3,
    );
    expect(url).toBe("http://h/x?id=" + encodeURIComponent("B I Z") + "&b=3");
  });
  it("readWechatCaptureConfig 缺失即抛", () => {
    expect(() => readWechatCaptureConfig(join(root, "nope"))).toThrow(/配置缺失/);
  });
  it("seen 读写往返，坏文件回退空集", () => {
    writeSeenIds(root, ["a", "b", "a"]);
    expect([...readSeenIds(root)].sort()).toEqual(["a", "b"]);
    writeFileSync(join(root, ".kunpeng", "wechat-capture", "seen.json"), "not json");
    expect(readSeenIds(root).size).toBe(0);
  });
});

describe("runWechatCaptureWave 真实串线（fake fetch + fake 入库）", () => {
  it("抓取→解析→入库→seen 持久→WaveResult", async () => {
    const captured: Capture[] = [];
    const calls: string[] = [];
    const res = await runWechatCaptureWave(loop(), "capture", undefined, {
      repoPath: root,
      fetchText: async (url: string) => { calls.push(url); return JSON.stringify({ general_msg_list: GENERAL }); },
      appendCapture: async (c: Capture) => { captured.push(c); return true; },
      now: 1720000200000,
      id: (() => { let n = 0; return () => `wc-${n++}`; })(),
    });
    expect(calls[0]).toContain("id=BIZ1");
    expect(captured.length).toBe(2);
    expect(captured[0].source).toBe("url");
    expect(captured[0].kind).toBe("wechat-article");
    expect(captured[0].tags).toContain("甲号");
    expect(captured[0].projectId).toBe("proj1");
    expect(res.metricDelta).toBe(2);
    expect(res.verified).toBe(true);
    expect(readSeenIds(root).size).toBe(2);
    expect(readdirSync(join(root, ".kunpeng", "wechat-capture")).some((f) => f.startsWith("report-"))).toBe(true);
  });

  it("第二波去重：已见文章不再入库", async () => {
    writeSeenIds(root, ["100_1"]);
    const captured: Capture[] = [];
    const res = await runWechatCaptureWave(loop(), "capture", undefined, {
      repoPath: root,
      fetchText: async () => JSON.stringify({ general_msg_list: GENERAL }),
      appendCapture: async (c: Capture) => { captured.push(c); return true; },
      now: 1, id: (() => { let n = 0; return () => `x${n++}`; })(),
    });
    expect(captured.map((c) => c.title)).toEqual(["文章二"]);
    expect(res.metricDelta).toBe(1);
  });

  it("fetch 抛错 → 该 target 记 error，波不崩，verified=false", async () => {
    const res = await runWechatCaptureWave(loop(), "capture", undefined, {
      repoPath: root,
      fetchText: async () => { throw new Error("网络挂了"); },
      appendCapture: async () => true,
      now: 1, id: () => "z",
    });
    expect(res.metricDelta).toBe(0);
    expect(res.verified).toBe(false);
    expect(res.detail).toContain("错 1/1");
  });

  it("maxArticlesPerWave 封顶", async () => {
    writeFileSync(
      join(root, ".kunpeng", "wechat-capture", "config.json"),
      JSON.stringify({
        exporterBaseUrl: "http://h", articleListPath: "/l?id={fakeid}&b={begin}",
        targets: [{ fakeid: "BIZ1", nickname: "甲号" }], maxArticlesPerWave: 1,
      }),
    );
    const captured: Capture[] = [];
    const res = await runWechatCaptureWave(loop(), "capture", undefined, {
      repoPath: root,
      fetchText: async () => JSON.stringify({ general_msg_list: GENERAL }),
      appendCapture: async (c: Capture) => { captured.push(c); return true; },
      now: 1, id: (() => { let n = 0; return () => `c${n++}`; })(),
    });
    expect(captured.length).toBe(1);
    expect(res.metricDelta).toBe(1);
  });
});

describe("recipe 注册", () => {
  it("wechat-capture 已进 recipeRegistry 且 runWave 可调用", () => {
    const r = recipeRegistry["wechat-capture"];
    expect(r).toBeTruthy();
    expect(typeof r.runWave).toBe("function");
    expect(r.id).toBe("wechat-capture");
  });
});
