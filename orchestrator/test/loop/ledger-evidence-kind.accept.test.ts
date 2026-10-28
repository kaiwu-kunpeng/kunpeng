import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLoopWave } from "../../src/loop/driver.js";
import { recipeRegistry, type LoopRecipe, type WaveResult } from "../../src/loop/recipe.js";
import { EVIDENCE_KINDS, type LoopDef, type Wave } from "../../src/loop/types.js";
import "../../src/loop/geo-monitor.js";
import "../../src/loop/agent-playbook.js";
import "../../src/loop/seo-internal-links.js";
import "../../src/loop/site-capture.js";
import "../../src/loop/wechat-capture.js";
import { loopViewFrom } from "../../src/server/state-collect/dashboard.js";
import type { DashboardState } from "../../src/server/state.js";
import { renderLoops } from "../../src/server/ui/views/loops.js";

// 背景（2026-10-03 运营审计 A3 G2，总报告 P0-5）：运营度量是自报代理值且无法区分真伪——GEO「AI 提及数」= 自家 LLM 自问自答，
// agent-playbook 指标 = 对本仓源码 grep，台账没有来源字段。本测试锁定：wave / 台账带 evidenceKind（recipe 给缺省、结果可覆盖）；
// 合成证据（llm-self-report）只能支撑 L0/L1，L2+ 波次即便 recipe 自报 verified 也降为未验证并写明原因；loops 页每波显示证据来源。

const RID = "ev-recipe";
let repoRoot: string;
function loop(over: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "ev-loop", name: "Evidence Loop", projectId: "ev-proj", recipe: RID, autonomous: true,
    metric: { key: "m", label: "M", current: 10 },
    levers: [{ id: "crawl", label: "抓", status: "active", level: "L0" }, { id: "rewrite", label: "改", status: "active", level: "L2" }],
    nextLever: { lever: "crawl", target: "https://x.example/" }, waves: [], createdAt: 1, updatedAt: 1, ...over,
  };
}
function recipe(result: WaveResult, defaultEvidenceKind: LoopRecipe["defaultEvidenceKind"]): LoopRecipe {
  return { id: RID, listLevers: (def) => def.levers, readMetric: async (def) => def.metric.current, defaultEvidenceKind, runWave: vi.fn(async () => result) };
}
function deps(def: LoopDef, r: LoopRecipe) {
  const appended: Wave[] = [];
  const finish = vi.fn(async () => undefined);
  return {
    appended, finish,
    deps: {
      repoRoot,
      store: { read: vi.fn(async () => def), appendWave: vi.fn(async (_id: string, w: Omit<Wave, "seq">) => { const wave = { seq: appended.length + 1, ...w } as Wave; appended.push(wave); return wave; }) },
      tracker: { start: vi.fn(async () => undefined), finish },
      getRecipe: () => r,
      resolveRepoPath: async () => repoRoot,
      env: {},
      now: () => 7_000,
    },
  };
}
function ledgerLines(): Array<Record<string, unknown>> {
  return readFileSync(join(repoRoot, ".kunpeng", "state", "ops", "actions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeEach(() => { repoRoot = mkdtempSync(join(tmpdir(), "kp-ev-")); execFileSync("git", ["init", "--quiet", repoRoot]); });
afterEach(() => { delete recipeRegistry[RID]; rmSync(repoRoot, { recursive: true, force: true }); });

describe("运营台账证据来源（作者锁定）", () => {
  it("四种证据来源常量；五个 recipe 的缺省：geo-monitor=llm-self-report、agent-playbook=repo-count、其余抓取类=crawl", () => {
    expect([...EVIDENCE_KINDS]).toEqual(["telemetry", "crawl", "llm-self-report", "repo-count"]);
    expect(recipeRegistry["geo-monitor"]?.defaultEvidenceKind).toBe("llm-self-report");
    expect(recipeRegistry["agent-playbook"]?.defaultEvidenceKind).toBe("repo-count");
    expect(recipeRegistry["seo-internal-links"]?.defaultEvidenceKind).toBe("crawl");
    expect(recipeRegistry["site-capture"]?.defaultEvidenceKind).toBe("crawl");
    expect(recipeRegistry["wechat-capture"]?.defaultEvidenceKind).toBe("crawl");
  });

  it("wave 与台账带 evidenceKind：recipe 缺省兜底，结果显式给的优先", async () => {
    const a = deps(loop(), recipe({ metricBefore: 10, metricAfter: 9, metricDelta: -1, verified: true }, "crawl"));
    const r1 = await runLoopWave("ev-loop", a.deps);
    expect(r1.gated).toBe(false);
    expect(a.appended[0]?.evidenceKind).toBe("crawl");
    expect(ledgerLines()[0]).toMatchObject({ loopId: "ev-loop", evidenceKind: "crawl", verified: true });

    const b = deps(loop(), recipe({ metricBefore: 10, metricAfter: 9, metricDelta: -1, verified: true, evidenceKind: "telemetry" }, "crawl"));
    await runLoopWave("ev-loop", b.deps);
    expect(b.appended[0]?.evidenceKind).toBe("telemetry");
    expect(ledgerLines()[1]).toMatchObject({ evidenceKind: "telemetry" });
  });

  it("合成证据只能推 L0/L1：L0 波照常 verified；L2 波即便自报 verified 也降为未验证、detail 写明 [synthetic-evidence]、流落 rolled-back", async () => {
    const ok = deps(loop(), recipe({ metricBefore: 10, metricAfter: 12, metricDelta: 2, verified: true }, "llm-self-report"));
    await runLoopWave("ev-loop", ok.deps);
    expect(ok.appended[0]).toMatchObject({ evidenceKind: "llm-self-report", verified: true, level: "L0" });
    expect(ok.finish).toHaveBeenCalledWith(expect.stringContaining("loop-ev-loop-w"), "verified");

    const bad = deps(loop({ nextLever: { lever: "rewrite", target: "page-1" } }), recipe({ metricBefore: 10, metricAfter: 12, metricDelta: 2, verified: true, detail: "改了 3 页" }, "llm-self-report"));
    const r = await runLoopWave("ev-loop", bad.deps);
    expect(r.gated).toBe(false);
    expect(bad.appended[0]).toMatchObject({ evidenceKind: "llm-self-report", verified: false, level: "L2" });
    expect(bad.appended[0]?.detail).toContain("[synthetic-evidence]");
    expect(bad.appended[0]?.detail).toContain("改了 3 页");
    expect(ledgerLines().at(-1)).toMatchObject({ verified: false, evidenceKind: "llm-self-report" });
    expect(bad.finish).toHaveBeenCalledWith(expect.stringContaining("loop-ev-loop-w"), "rolled-back", undefined, expect.stringContaining("[synthetic-evidence]"));
  });

  it("loops 页：LoopView 带出 evidenceKind，每波渲染「证据·来源」标签，合成证据标 tag-warn", () => {
    const def = loop({ waves: [
      { seq: 1, at: 1_000, lever: "crawl", subject: "A", metricDelta: 1, metricAfter: 11, verified: true, evidenceKind: "crawl" },
      { seq: 2, at: 2_000, lever: "rewrite", subject: "B", metricDelta: 2, metricAfter: 13, verified: false, evidenceKind: "llm-self-report" },
    ] });
    const view = loopViewFrom(def, 10_000);
    expect(view.recent.map((w) => w.evidenceKind)).toEqual(["llm-self-report", "crawl"]);
    expect(view.waves?.[0]?.evidenceKind).toBe("llm-self-report");
    const html = renderLoops({ loops: [view] } as unknown as DashboardState);
    expect(html).toContain("证据·crawl");
    expect(html).toMatch(/tag tag-warn[^>]*>证据·llm-self-report/);
  });
});