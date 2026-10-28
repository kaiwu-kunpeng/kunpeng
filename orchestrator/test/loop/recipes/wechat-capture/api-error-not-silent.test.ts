import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readWechatApiError, summarizeCaptureWave } from "../../../../src/loop/recipes/wechat-capture/core.js";
import { runWechatCaptureWave } from "../../../../src/loop/recipes/wechat-capture/runwave.js";
import type { Capture } from "../../../../src/knowledge/capture-store.js";
import type { LoopDef } from "../../../../src/loop/types.js";

// 2026-08-02 线上实测的限频体，一字未改。
const FREQ_CONTROL = JSON.stringify({ base_resp: { err_msg: "freq control", ret: 200013 } });
const INVALID_SESSION = JSON.stringify({ base_resp: { err_msg: "invalid session", ret: 200003 } });
const OK_LIST = JSON.stringify({
  base_resp: { err_msg: "ok", ret: 0 },
  articles: [
    {
      aid: "2651357747_1",
      title: "官方购票渠道说明",
      link: "https://mp.weixin.qq.com/s/0Y3eUXFVzCM3bMsTkhz9rA",
      digest: "只此一家",
      create_time: 1783674660,
      is_deleted: false,
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
  root = mkdtempSync(join(tmpdir(), "kp-wc-err-"));
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

describe("readWechatApiError 只认接口级失败", () => {
  it("限频体给出带 ret 与 err_msg 的错误", () => {
    const msg = readWechatApiError(FREQ_CONTROL);
    expect(msg, "限频必须被认成错误").toBeTruthy();
    expect(msg).toContain("200013");
    expect(msg).toContain("freq control");
  });

  it("会话失效同样被认成错误", () => {
    expect(readWechatApiError(INVALID_SESSION)).toContain("200003");
  });

  it("ret=0、非 JSON、无 base_resp 一律不算错误", () => {
    expect(readWechatApiError(OK_LIST)).toBeUndefined();
    expect(readWechatApiError('{"base_resp":{"ret":0,"err_msg":"ok"}}')).toBeUndefined();
    expect(readWechatApiError("<html>not json</html>")).toBeUndefined();
    expect(readWechatApiError('{"general_msg_list":"{}"}')).toBeUndefined();
  });
});

describe("真实串线：限频不再被记成「没有新文章」", () => {
  it("target 结果带 error、不入库，且汇总错误数不为 0", async () => {
    const captured: Capture[] = [];
    const results: { target: unknown; fetched: number; captured: unknown[]; error?: string }[] = [];
    await runWechatCaptureWave(loop(), "capture", undefined, {
      repoPath: root,
      fetchText: async () => FREQ_CONTROL,
      appendCapture: async (c: Capture) => { captured.push(c); return true; },
      now: 1785643289248,
      id: (() => { let n = 0; return () => `wc-${n++}`; })(),
    });

    // 波次报告逐 target 落盘，错误必须留痕。
    const dir = join(root, ".kunpeng", "wechat-capture");
    const reportFile = readdirSync(dir).find((f) => f.startsWith("report-"));
    expect(reportFile, "波次必须落一份报告").toBeTruthy();
    const report = JSON.parse(readFileSync(join(dir, String(reportFile)), "utf8"));
    results.push(...report.results);

    expect(captured.length, "限频时不该有任何入库").toBe(0);
    expect(results[0]?.error, "限频必须写进该 target 的 error").toBeTruthy();
    expect(String(results[0]?.error)).toContain("200013");
    expect(report.summary.errors, "汇总错误数不能是 0").toBeGreaterThan(0);
  });

  it("正常返回体不受影响：照常入库且不带 error", async () => {
    const captured: Capture[] = [];
    const res = await runWechatCaptureWave(loop(), "capture", undefined, {
      repoPath: root,
      fetchText: async () => OK_LIST,
      appendCapture: async (c: Capture) => { captured.push(c); return true; },
      now: 1785643289248,
      id: (() => { let n = 0; return () => `wc-${n++}`; })(),
    });
    expect(captured.length).toBe(1);
    expect(res.metricDelta).toBe(1);
  });
});

describe("summarizeCaptureWave 收得到这条错误", () => {
  it("带 error 的结果计入 errors", () => {
    const summary = summarizeCaptureWave([
      { target: { fakeid: "BIZ1", nickname: "甲" }, fetched: 0, captured: [], error: "接口返回 ret=200013 freq control" },
      { target: { fakeid: "BIZ2", nickname: "乙" }, fetched: 0, captured: [] },
    ] as never);
    expect(summary.errors).toBe(1);
  });
});