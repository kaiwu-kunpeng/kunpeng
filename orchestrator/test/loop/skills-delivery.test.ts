import { describe, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pilotNext } from "../../src/loop/ops-pilot.js";
import { runLoopWave } from "../../src/loop/driver.js";
import { runAgentPlaybookWave } from "../../src/loop/recipes/agent-playbook/runwave.js";
import { runGeoMonitorWave } from "../../src/loop/recipes/geo-monitor/runwave.js";
import { buildWaveReport } from "../../src/loop/wave-report.js";
import { LoopDefSchema, type LoopDef, type Wave } from "../../src/loop/types.js";
import type { OpsAction } from "../../src/loop/action-ledger.js";

function mkdtemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function loopDef(overrides: Partial<LoopDef> = {}): LoopDef {
  return {
    id: "tl-geo-audit",
    name: "GEO 审计",
    projectId: "kunpeng",
    recipe: "agent-playbook",
    autonomous: true,
    metric: { key: "auditActions", label: "审计行动项数", current: 7, observational: true },
    levers: [{ id: "tl-geo-audit", label: "只读审计", status: "active" }],
    nextLever: { lever: "tl-geo-audit" },
    waves: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

// 不在源码里写三个反引号的字面量,免得被 spec 的代码围栏提前截断。
const FENCE = "`".repeat(3);

function aopBody(): string {
  return [`${FENCE}aop`, JSON.stringify({ goal: "只读审计", steps: [{ id: "s1", prompt: "清点页面" }] }), FENCE].join("\n");
}

function action(overrides: Partial<OpsAction> = {}): OpsAction {
  return {
    at: 1, loopId: "tl-geo-audit", projectId: "kunpeng", recipe: "agent-playbook",
    lever: "tl-geo-audit", subject: "tl-geo-audit", metricKey: "auditActions",
    metricAfter: 7, metricDelta: 0, verified: true,
    ...overrides,
  };
}

describe("ops-pilot 选中的技能真送达(作者锁定)", () => {
  test("schema:nextLever.skills 合法,旧形状不带该字段也合法", () => {
    const parsed = LoopDefSchema.parse(loopDef({ nextLever: { lever: "tl-geo-audit", skills: ["geo-answer-optimization"] } }));
    expect(parsed.nextLever?.skills).toEqual(["geo-answer-optimization"]);
    expect(LoopDefSchema.parse(loopDef()).nextLever).toEqual({ lever: "tl-geo-audit" });
  });

  test("pilotNext:选中的技能写进 nextLever.skills,note 格式不变", async () => {
    const skillsRoot = mkdtemp("kp-skills-");
    writeFileSync(join(skillsRoot, "index.json"), JSON.stringify([
      { id: "geo-answer-optimization", name: "GEO 直答优化", description: "让页面成为 AI 引用来源", dir: join(skillsRoot, "geo-answer-optimization"), registeredAt: "2026-01-01T00:00:00.000Z" },
      { id: "schema", name: "Schema", description: "结构化数据", dir: join(skillsRoot, "schema"), registeredAt: "2026-01-01T00:00:00.000Z" },
    ]));
    const stateDir = mkdtemp("kp-state-");
    const setNext = vi.fn(async () => undefined);
    const runner = {
      run: async () => ({
        text: '{"lever":"tl-geo-audit","skills":["geo-answer-optimization","ghost"],"waveGoal":"只读审计出报告","stopLoss":"两波无报告","reason":"r"}',
      }),
    };
    const r = await pilotNext("tl-geo-audit", { runner, store: { read: async () => loopDef(), setNext } as never, skillsRoot, stateDir });
    expect(r.applied).toBe(true);
    expect(setNext).toHaveBeenCalledWith("tl-geo-audit", {
      lever: "tl-geo-audit",
      note: "只读审计出报告 | skills:geo-answer-optimization | stopLoss:两波无报告",
      skills: ["geo-answer-optimization"],
    });
  });

  test("pilotNext:一个技能都没选 → 不写 skills 字段", async () => {
    const skillsRoot = mkdtemp("kp-skills-empty-");
    writeFileSync(join(skillsRoot, "index.json"), "[]");
    const setNext = vi.fn(async () => undefined);
    const runner = { run: async () => ({ text: '{"lever":"tl-geo-audit","skills":[],"waveGoal":"g","stopLoss":"s","reason":"r"}' }) };
    await pilotNext("tl-geo-audit", { runner, store: { read: async () => loopDef(), setNext } as never, skillsRoot, stateDir: mkdtemp("kp-state-empty-") });
    expect(setNext).toHaveBeenCalledWith("tl-geo-audit", { lever: "tl-geo-audit", note: "g | skills: | stopLoss:s" });
  });

  test("driver:nextLever.skills 进 runWave deps;skillsActivated 写进台账 action.skills;Wave 不多字段", async () => {
    const repoRoot = mkdtemp("kp-skills-driver-");
    execFileSync("git", ["init", "--quiet", repoRoot]);
    const runWave = vi.fn(async () => ({
      metricBefore: 7, metricAfter: 7, metricDelta: 0, verified: true, detail: "passed 1/1",
      skillsActivated: ["seo-audit", "geo-answer-optimization"],
    }));
    const appendWave = vi.fn(async (_id: string, wave: Omit<Wave, "seq">) => ({ seq: 2, ...wave }));
    await runLoopWave("tl-geo-audit", {
      repoRoot,
      store: {
        read: vi.fn(async () => loopDef({ nextLever: { lever: "tl-geo-audit", note: "n", skills: ["geo-answer-optimization"] } })),
        appendWave,
      },
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      getRecipe: () => ({ id: "agent-playbook", listLevers: (d) => d.levers, readMetric: async (d) => d.metric.current, runWave }),
      resolveRepoPath: async () => repoRoot,
      learningStore: { append: vi.fn(async () => undefined) },
      now: () => 1000,
    });
    expect(runWave).toHaveBeenCalledWith(
      expect.anything(),
      "tl-geo-audit",
      undefined,
      expect.objectContaining({ repoPath: repoRoot, skills: ["geo-answer-optimization"] }),
    );
    const wave = appendWave.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(wave).not.toHaveProperty("skills");
    expect(wave).not.toHaveProperty("skillsActivated");
    const ledger = readFileSync(join(repoRoot, ".kunpeng", "state", "ops", "actions.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(ledger.at(-1)).toMatchObject({ loopId: "tl-geo-audit", skills: ["seo-audit", "geo-answer-optimization"] });
  });

  test("driver:没有 nextLever.skills 时 deps.skills 为空数组", async () => {
    const repoRoot = mkdtemp("kp-skills-driver-none-");
    execFileSync("git", ["init", "--quiet", repoRoot]);
    const runWave = vi.fn(async () => ({ metricBefore: 7, metricAfter: 7, metricDelta: 0, verified: true }));
    await runLoopWave("tl-geo-audit", {
      repoRoot,
      store: { read: vi.fn(async () => loopDef()), appendWave: vi.fn(async (_id: string, wave: Omit<Wave, "seq">) => ({ seq: 1, ...wave })) },
      tracker: { start: vi.fn(async () => undefined), finish: vi.fn(async () => undefined) },
      getRecipe: () => ({ id: "agent-playbook", listLevers: (d) => d.levers, readMetric: async (d) => d.metric.current, runWave }),
      resolveRepoPath: async () => repoRoot,
      learningStore: { append: vi.fn(async () => undefined) },
      now: () => 1000,
    });
    expect(runWave).toHaveBeenCalledWith(expect.anything(), "tl-geo-audit", undefined, expect.objectContaining({ skills: [] }));
    const ledger = readFileSync(join(repoRoot, ".kunpeng", "state", "ops", "actions.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(ledger.at(-1)).not.toHaveProperty("skills");
  });

  test("agent-playbook:声明技能在前、送达技能在后、去重,全部进 prompt 并报回 skillsActivated", async () => {
    const ran: string[] = [];
    const r = await runAgentPlaybookWave(loopDef(), "tl-geo-audit", undefined, {
      repoPath: mkdtemp("kp-apb-"),
      runner: { async runStep(prompt: string) { ran.push(prompt); } },
      loadPlaybook: async () => ({ body: aopBody(), skills: ["seo-audit"] }),
      loadSkill: async (id: string) => ({ "seo-audit": "审计正文", "geo-answer-optimization": "直答正文" } as Record<string, string>)[id],
      execAssert: async () => 0,
      skills: ["geo-answer-optimization", "seo-audit"],
    });
    expect(r.verified).toBe(true);
    expect(ran).toHaveLength(1);
    expect(ran[0]).toContain("【技能·seo-audit】");
    expect(ran[0]).toContain("审计正文");
    expect(ran[0]).toContain("【技能·geo-answer-optimization】");
    expect(ran[0]).toContain("直答正文");
    expect(ran[0].indexOf("【技能·seo-audit】")).toBeLessThan(ran[0].indexOf("【技能·geo-answer-optimization】"));
    expect(r.skillsActivated).toEqual(["seo-audit", "geo-answer-optimization"]);
  });

  test("agent-playbook:送达的技能未注册 → 与声明未注册一样整浪失败并点名", async () => {
    const ran: string[] = [];
    const r = await runAgentPlaybookWave(loopDef(), "tl-geo-audit", undefined, {
      repoPath: mkdtemp("kp-apb-ghost-"),
      runner: { async runStep(prompt: string) { ran.push(prompt); } },
      loadPlaybook: async () => ({ body: aopBody() }),
      loadSkill: async () => undefined,
      execAssert: async () => 0,
      skills: ["ghost-skill"],
    });
    expect(r.verified).toBe(false);
    expect(ran).toHaveLength(0);
    expect((r.gotchas ?? []).join(" ")).toContain("ghost-skill");
  });

  test("agent-playbook:无声明无送达 → prompt 与现状一致,skillsActivated 为空数组", async () => {
    const ran: string[] = [];
    const r = await runAgentPlaybookWave(loopDef(), "tl-geo-audit", undefined, {
      repoPath: mkdtemp("kp-apb-none-"),
      runner: { async runStep(prompt: string) { ran.push(prompt); } },
      loadPlaybook: async () => ({ body: aopBody() }),
      loadSkill: async () => undefined,
      execAssert: async () => 0,
      skills: [],
    });
    expect(r.verified).toBe(true);
    expect(ran[0].startsWith("目标:")).toBe(true);
    expect(r.skillsActivated).toEqual([]);
  });

  test("geo-monitor:显式忽略送达技能,报告记 ignoredSkills,skillsActivated 为空", async () => {
    const repo = mkdtemp("kp-geo-skills-");
    mkdirSync(join(repo, ".kunpeng", "geo"), { recursive: true });
    writeFileSync(join(repo, ".kunpeng", "geo", "config.json"), JSON.stringify({
      brandNames: ["DemoTravel"], brandDomains: ["demo-travel.ai"], questions: ["q1"],
    }));
    const runner = { run: async () => ({ text: JSON.stringify({ summary: "s", citedUrls: ["https://demo-travel.ai/a"], mentionedBrand: true }), meta: {} }) };
    const r = await runGeoMonitorWave(
      loopDef({ id: "demo-geo-monitor", recipe: "geo-monitor", levers: [{ id: "geo-sweep", label: "全扫", status: "active" }], nextLever: { lever: "geo-sweep" } }),
      "geo-sweep", undefined,
      { agentRunner: runner, repoPath: repo, now: 77, skills: ["seo-audit"] },
    );
    expect(r.skillsActivated).toEqual([]);
    expect(r.metricAfter).toBe(1);
    const report = JSON.parse(readFileSync(join(repo, ".kunpeng", "geo", "report-77.json"), "utf8"));
    expect(report.ignoredSkills).toEqual(["seo-audit"]);
  });

  test("波报告:本波技能按实际注入记账,列出计划未送达;旧波标注仅计划", () => {
    const actual = buildWaveReport({
      loop: { id: "tl-geo-audit", name: "GEO 审计", metric: { label: "审计行动项数", current: 7 } },
      action: action({ skills: ["seo-audit"] }),
      planSkills: ["seo-audit", "schema", "directory-submissions"],
    });
    expect(actual).toContain("## 本波技能");
    expect(actual).toContain("- seo-audit");
    expect(actual).toContain("- 计划未送达: schema, directory-submissions");
    expect(actual).not.toContain("- schema\n");

    const legacy = buildWaveReport({
      loop: { id: "tl-geo-audit", name: "GEO 审计", metric: { label: "审计行动项数", current: 7 } },
      action: action(),
      planSkills: ["schema"],
    });
    expect(legacy).toContain("- schema");
    expect(legacy).toContain("仅计划");

    const nothingMissing = buildWaveReport({
      loop: { id: "tl-geo-audit", name: "GEO 审计", metric: { label: "审计行动项数", current: 7 } },
      action: action({ skills: ["seo-audit"] }),
      planSkills: ["seo-audit"],
    });
    expect(nothingMissing).toContain("- 计划未送达: (无)");
  });
});