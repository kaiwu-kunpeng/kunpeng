import { describe, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGeoMonitorWave } from "../../src/loop/recipes/geo-monitor/runwave.js";
import { summarizeGeoWave, type GeoAnswer } from "../../src/loop/recipes/geo-monitor/core.js";
import { runLoopWave } from "../../src/loop/driver.js";
import { consecutiveNoProgress, windowFailureRate } from "../../src/loop/ops-guard.js";
import { deriveLearning } from "../../src/loop/learnings.js";
import type { OpsAction } from "../../src/loop/action-ledger.js";
import type { LoopDef, Wave } from "../../src/loop/types.js";

// 2026-09-05 某托管站真实报告 report-1788615097023.json 的 8 道题:8/8 unparseable,
// 台账却写了 metricAfter 0 / delta -5;另外两个托管站同日同形态。(测试里不写客户名:detenant 守卫)
const QUESTIONS_0905 = [
  "What should I do in my first night in China after landing — what has to be set up before I sleep?",
  "My foreign credit card keeps getting declined when I link it to Alipay in China — how do I fix it?",
  "How do I pay for the metro in Chinese cities with QR codes as a foreigner?",
  "Do I have to register with the police if I stay in an apartment or a friend's home in China instead of a hotel?",
  "Can I bring my prescription medication into China, and what happens if it is a controlled drug?",
  "What do China's coloured weather warning signals actually require — when does work or transport stop?",
  "How much cash can I carry into or out of China before I have to declare it?",
  "What happens if my EES record in Europe is wrong, or if I refuse to give fingerprints at the border?",
];

function geoLoop(current: number, overrides: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "demo-geo-monitor",
    name: "DemoTravel GEO",
    projectId: "demo",
    recipe: "geo-monitor",
    autonomous: true,
    metric: { key: "mentions", label: "AI 提及数", current, observational: true },
    levers: [{ id: "geo-sweep", label: "问题库全扫", status: "active" }],
    nextLever: { lever: "geo-sweep" },
    waves: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function repoWithQuestions(questions: string[]): string {
  const repo = mkdtemp("kp-geo-health-");
  mkdirSync(join(repo, ".kunpeng", "geo"), { recursive: true });
  writeFileSync(join(repo, ".kunpeng", "geo", "config.json"), JSON.stringify({
    brandNames: ["DemoTravel"],
    brandDomains: ["demo-travel.ai"],
    questions,
  }));
  return repo;
}

function mkdtemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const answerOf = (mentioned: boolean, urls: string[]) =>
  JSON.stringify({ summary: "s", citedUrls: urls, mentionedBrand: mentioned });

describe("geo-monitor 仪器健康门(作者锁定)", () => {
  test("回放 09-05:8/8 unparseable → 指标不动、delta 0、verified false、instrumentBroken true、报告带来源", async () => {
    const repo = repoWithQuestions(QUESTIONS_0905);
    const runner = {
      run: async () => ({
        text: "I'm sorry, I was unable to complete the live web search for this question.",
        meta: {},
        backend: "claude",
        modelUsed: "opus@high",
      }),
    };
    const r = await runGeoMonitorWave(geoLoop(5), "geo-sweep", undefined, { agentRunner: runner, repoPath: repo, now: 1788615097023 });
    expect(r.instrumentBroken).toBe(true);
    expect(r.verified).toBe(false);
    expect(r.metricBefore).toBe(5);
    expect(r.metricAfter).toBe(5);
    expect(r.metricDelta).toBe(0);
    expect(r.detail?.startsWith("仪器故障：")).toBe(true);
    expect(r.detail).toContain("8/8");

    const files = readdirSync(join(repo, ".kunpeng", "geo")).filter((f) => f.startsWith("report-"));
    expect(files).toEqual(["report-1788615097023.json"]);
    const report = JSON.parse(readFileSync(join(repo, ".kunpeng", "geo", files[0]), "utf8"));
    expect(report.summary).toMatchObject({ mentions: 0, total: 8, errors: 8, instrumentBroken: true });
    expect(report.instrument).toEqual({ broken: true, backend: "claude", model: "opus@high", at: 1788615097023 });
    expect(report.answers).toHaveLength(8);
    expect(report.answers[0]).toMatchObject({ error: "unparseable", backend: "claude", model: "opus@high", at: 1788615097023 });
  });

  test("部分题失败(2/3)不是仪器故障:指标照常写入、verified true", async () => {
    const repo = repoWithQuestions(["q-sim-card", "q-visa-renewal", "q-alipay-setup"]);
    const runner = {
      run: async (req: { input: string }) => {
        if (req.input.includes("q-sim-card")) {
          return { text: answerOf(true, ["https://demo-travel.ai/sim"]), meta: {}, backend: "codex", modelUsed: "gpt-5.5@high" };
        }
        throw new Error("engine down");
      },
    };
    const r = await runGeoMonitorWave(geoLoop(3), "geo-sweep", undefined, { agentRunner: runner, repoPath: repo, now: 7 });
    expect(r.instrumentBroken).toBe(false);
    expect(r.verified).toBe(true);
    expect(r.metricAfter).toBe(1);
    expect(r.metricDelta).toBe(-2);
    const report = JSON.parse(readFileSync(join(repo, ".kunpeng", "geo", "report-7.json"), "utf8"));
    expect(report.summary).toMatchObject({ mentions: 1, total: 3, errors: 2, instrumentBroken: false });
    expect(report.instrument).toEqual({ broken: false, backend: "codex", model: "gpt-5.5@high", at: 7 });
    expect(report.answers[0]).toMatchObject({ mentioned: true, backend: "codex", model: "gpt-5.5@high", at: 7 });
    expect(report.answers[1]).toMatchObject({ error: "Error: engine down", at: 7 });
  });

  test("summarizeGeoWave:全错才算故障,零题不算", () => {
    const bad: GeoAnswer = { question: "q", mentioned: false, citedDomains: [], citedUrls: [], error: "unparseable" };
    const good: GeoAnswer = { question: "q2", mentioned: true, citedDomains: ["demo-travel.ai"], citedUrls: [] };
    expect(summarizeGeoWave([]).instrumentBroken).toBe(false);
    expect(summarizeGeoWave([bad]).instrumentBroken).toBe(true);
    expect(summarizeGeoWave([bad, bad, bad]).instrumentBroken).toBe(true);
    expect(summarizeGeoWave([bad, good]).instrumentBroken).toBe(false);
  });

  test("driver:仪器故障波 → appendWave 带 instrumentBroken、指标不动、flow rolled-back、学习条目点名仪器", async () => {
    const repoRoot = mkdtemp("kp-geo-driver-");
    execFileSync("git", ["init", "--quiet", repoRoot]);
    const source = geoLoop(5, { recipe: "geo-instrument-probe" });
    const appendWave = vi.fn(async (_id: string, wave: Omit<Wave, "seq">) => ({ seq: 3, ...wave }));
    const finish = vi.fn(async () => undefined);
    const append = vi.fn(async () => undefined);
    const runWave = vi.fn(async () => ({
      metricBefore: 5,
      metricAfter: 5,
      metricDelta: 0,
      verified: false,
      instrumentBroken: true,
      detail: "仪器故障：8/8 题无法解析，本波不计入指标",
    }));

    await runLoopWave("demo-geo-monitor", {
      repoRoot,
      store: { read: vi.fn(async () => source), appendWave },
      tracker: { start: vi.fn(async () => undefined), finish },
      getRecipe: () => ({ id: "geo-instrument-probe", listLevers: (d) => d.levers, readMetric: async (d) => d.metric.current, runWave }),
      resolveRepoPath: async () => repoRoot,
      learningStore: { append },
      now: () => 1788615097023,
    });

    expect(appendWave).toHaveBeenCalledWith("demo-geo-monitor", expect.objectContaining({
      at: 1788615097023,
      metricAfter: 5,
      metricDelta: 0,
      verified: false,
      instrumentBroken: true,
    }));
    expect(finish).toHaveBeenCalledWith("loop-demo-geo-monitor-w3", "rolled-back", undefined, expect.stringContaining("仪器故障"));
    expect(append).toHaveBeenCalledWith("demo-geo-monitor", expect.objectContaining({ kind: "blocked", lesson: expect.stringContaining("仪器故障") }));
    const ledger = readFileSync(join(repoRoot, ".kunpeng", "state", "ops", "actions.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(ledger.at(-1)).toMatchObject({ loopId: "demo-geo-monitor", metricDelta: 0, verified: false, instrumentBroken: true });
  });

  test("driver:正常波不多出 instrumentBroken 字段(既有精确匹配测试不受影响)", async () => {
    const repoRoot = mkdtemp("kp-geo-driver-ok-");
    execFileSync("git", ["init", "--quiet", repoRoot]);
    const appendWave = vi.fn(async (_id: string, wave: Omit<Wave, "seq">) => ({ seq: 1, ...wave }));
    await runLoopWave("demo-geo-monitor", {
      repoRoot,
      store: { read: vi.fn(async () => geoLoop(5, { recipe: "geo-instrument-probe" })), appendWave },
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      getRecipe: () => ({
        id: "geo-instrument-probe",
        listLevers: (d) => d.levers,
        readMetric: async (d) => d.metric.current,
        runWave: async () => ({ metricBefore: 5, metricAfter: 6, metricDelta: 1, verified: true, instrumentBroken: false, detail: "提及 6/8（错 0）" }),
      }),
      resolveRepoPath: async () => repoRoot,
      learningStore: { append: vi.fn(async () => undefined) },
      now: () => 10,
    });
    const wave = appendWave.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(wave).not.toHaveProperty("instrumentBroken");
    expect(wave.metricAfter).toBe(6);
  });

  test("护栏:仪器故障波既不计连败也不打断计数;正常零增量波仍计数", () => {
    const base = { loopId: "l", projectId: "p", recipe: "geo-monitor", lever: "geo-sweep", subject: "geo-sweep", metricKey: "mentions" };
    const actions: OpsAction[] = [
      { ...base, at: 1, metricAfter: 3, metricDelta: -1, verified: true },
      { ...base, at: 2, metricAfter: 5, metricDelta: 2, verified: true },
      { ...base, at: 3, metricAfter: 5, metricDelta: 0, verified: false, instrumentBroken: true },
      { ...base, at: 4, metricAfter: 5, metricDelta: 0, verified: false, instrumentBroken: true },
    ];
    expect(consecutiveNoProgress(actions, "l")).toBe(0);
    expect(consecutiveNoProgress(actions, "l", { observational: true })).toBe(0);
    expect(windowFailureRate(actions, "l")).toEqual({ considered: 2, failed: 1, rate: 0.5 });
    expect(windowFailureRate(actions, "l", { observational: true })).toEqual({ considered: 2, failed: 0, rate: 0 });

    const withRealStall = [...actions, { ...base, at: 5, metricAfter: 5, metricDelta: 0, verified: true }];
    expect(consecutiveNoProgress(withRealStall, "l")).toBe(1);
    expect(consecutiveNoProgress(withRealStall, "l", { observational: true })).toBe(0);
  });

  test("学习条目:仪器故障不再写成「零增量疑数据源薄」", () => {
    const wave: Wave = {
      seq: 3, at: 1, lever: "geo-sweep", subject: "geo-sweep",
      metricDelta: 0, metricAfter: 5, verified: false, instrumentBroken: true,
      detail: "仪器故障：8/8 题无法解析，本波不计入指标",
    };
    const learning = deriveLearning(wave);
    expect(learning?.kind).toBe("blocked");
    expect(learning?.lesson).toContain("仪器故障");
    expect(learning?.lesson).not.toContain("数据源薄");
    const plain = deriveLearning({ ...wave, instrumentBroken: undefined, detail: "提及 0/8（错 0）" });
    expect(plain?.lesson).toContain("未验证且零增量");
  });
});