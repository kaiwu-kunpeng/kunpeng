import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGeoMonitorWave } from "./runwave.js";
import type { LoopDef } from "../../types.js";

function geoLoop(): LoopDef {
  return {
    id: "demo-travel-geo",
    name: "DemoTravel GEO",
    projectId: "repo",
    recipe: "geo-monitor",
    autonomous: true,
    metric: { key: "geoMentions", label: "AI 提及数", current: 0 },
    levers: [{ id: "geo-sweep", label: "问题库全扫", status: "active" }],
    nextLever: { lever: "geo-sweep" },
    waves: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

const answerOf = (mentioned: boolean, domains: string[]) =>
  JSON.stringify({ summary: "s", citedDomains: domains, mentionedBrand: mentioned });

describe("runGeoMonitorWave", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "kp-geo-"));
    mkdirSync(join(repo, ".kunpeng", "geo"), { recursive: true });
    writeFileSync(join(repo, ".kunpeng", "geo", "config.json"), JSON.stringify({
      brandNames: ["DemoTravel"],
      brandDomains: ["demo-travel.ai"],
      questions: ["q-sim-card", "q-visa-renewal", "q-alipay-setup"],
    }));
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  it("全链：逐题问引擎→汇总→报告落盘→WaveResult", async () => {
    const seen: string[] = [];
    const fakeRunner = {
      run: async (req: { input: string; tools: string[] }) => {
        seen.push(req.input);
        expect(req.tools).toContain("websearch");
        if (req.input.includes("q-sim-card")) return { text: answerOf(true, ["demo-travel.ai"]), meta: {} };
        if (req.input.includes("q-visa-renewal")) return { text: answerOf(false, ["china-briefing.com"]), meta: {} };
        throw new Error("engine down");
      },
    };
    const r = await runGeoMonitorWave(geoLoop(), "geo-sweep", undefined, { agentRunner: fakeRunner, repoPath: repo, now: 12345 });
    expect(seen.length).toBe(3);
    expect(r.metricAfter).toBe(1);
    expect(r.metricDelta).toBe(1);
    expect(r.verified).toBe(true);
    expect(r.detail).toContain("1/3");
    expect(r.gotchas?.some((g) => g.includes("内容缺口") && g.includes("q-visa-renewal"))).toBe(true);
    const reports = readdirSync(join(repo, ".kunpeng", "geo")).filter((f) => f.startsWith("report-"));
    expect(reports.length).toBe(1);
  });

  it("maxQuestions 截断；缺配置显性失败", async () => {
    const fakeRunner = { run: async () => ({ text: answerOf(false, []), meta: {} }) };
    const r = await runGeoMonitorWave(geoLoop(), "geo-sweep", undefined, { agentRunner: fakeRunner, repoPath: repo, maxQuestions: 2, now: 2 });
    expect(r.detail).toContain("/2");
    const empty = mkdtempSync(join(tmpdir(), "kp-geo-empty-"));
    await expect(runGeoMonitorWave(geoLoop(), "geo-sweep", undefined, { agentRunner: fakeRunner, repoPath: empty, now: 3 })).rejects.toThrow();
  });
});