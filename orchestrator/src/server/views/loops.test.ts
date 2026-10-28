import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ArtifactStore } from "../../artifacts/store.js";
import { LoopLearningStore } from "../../loop/learnings.js";
import { LoopStore } from "../../loop/store.js";
import type { LoopDef } from "../../loop/types.js";
import { aggregateLoops, collectState, type DashboardState, type LoopView, type ProjectSnapshot } from "../state.js";
import { renderLoops } from "../ui/views/loops.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-loops-view-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
});

function loopFixture(now: number): LoopDef {
  return {
    id: "growth-loop",
    name: "增长运营 Loop",
    projectId: "project-1",
    recipe: "ship waves",
    metric: { key: "activation", label: "激活率", current: 42 },
    levers: [
      { id: "pricing", label: "价格页实验", status: "active" },
      { id: "onboarding", label: "新手引导", status: "needs-dev" },
      { id: "ads", label: "投放素材", status: "honest-zero" },
    ],
    nextLever: { lever: "onboarding", target: "activation", note: "补齐首轮引导" },
    waves: [
      {
        seq: 1,
        at: now - 2 * 60 * 60000,
        lever: "pricing",
        subject: "价格页标题",
        metricDelta: 3,
        metricAfter: 39,
        deploy: "deploy-a",
        verified: true,
        gotchas: ["样本太小", "日志延迟"],
      },
      {
        seq: 2,
        at: now - 30 * 60000,
        lever: "onboarding",
        subject: "首轮任务清单",
        metricDelta: 3,
        metricAfter: 42,
        deploy: "deploy-b",
        verified: false,
        gotchas: ["样本太小", "移动端入口弱"],
      },
    ],
    createdAt: now - 3 * 60 * 60000,
    updatedAt: now - 30 * 60000,
  };
}

function baseState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 1,
    flows: [],
    running: [],
    blockers: [],
    humanGates: [],
    artifacts: {},
    branches: [],
    statusCounts: {},
    systemLight: "green",
    agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" },
    plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [],
    health: { alerts: [], running: 0, healthy: 0 },
    evolution: { lastRunText: "尚未巡检", pendingCount: 0, proposals: [], regression: { holdout: 0, optimization: 0 }, approvedCount: 0 },
    ...overrides,
  };
}

function costSummary(tokensByModel: Record<string, number>) {
  return {
    totalTokens: 12300,
    totalStages: 0,
    llmStages: 0,
    deterministicStages: 0,
    determinismRatio: 0,
    savedLlmCalls: 0,
    tokensByStage: {},
    tokensByModel,
  };
}

describe("loops state and view", () => {
  test("collectState reads LoopStore and renderLoops exposes panels, waves, levers, next highlight, and deduped gotchas", async () => {
    const now = Date.now();
    const loopStore = new LoopStore(join(repo, ".kunpeng", "loops"));
    await loopStore.create(loopFixture(now));
    const learningStore = new LoopLearningStore(join(repo, ".kunpeng", "loops"));
    await learningStore.append("growth-loop", {
      at: 0,
      waveSeq: 1,
      lever: "new-category",
      subject: "VAPOR_CANISTER",
      kind: "weak",
      lesson: "VAPOR_CANISTER：候选供应商全无带价",
    });

    const state = await collectState(new ArtifactStore(join(repo, ".kunpeng", "artifacts")), repo, { kunpengHome: repo });

    expect(state.loops).toHaveLength(1);
    expect(state.loops?.[0].waveCount).toBe(2);
    expect(state.loops?.[0].recent.map((wave) => wave.seq)).toEqual([2, 1]);
    expect(state.loops?.[0].metric).toEqual({ label: "激活率", current: 42 });
    expect(state.loops?.[0].leversByStatus.active.map((lever) => lever.id)).toEqual(["pricing"]);
    expect(state.loops?.[0].leversByStatus.needsDev.map((lever) => lever.id)).toEqual(["onboarding"]);
    expect(state.loops?.[0].leversByStatus.honestZero.map((lever) => lever.id)).toEqual(["ads"]);
    expect(state.loops?.[0].nextLever?.id).toBe("onboarding");
    expect(state.loops?.[0].gotchas).toEqual(["样本太小", "移动端入口弱", "日志延迟"]);
    expect(typeof state.loops?.[0].summary.trend).toBe("string");
    expect(state.loops?.[0].summary.trend).toContain("势头");
    expect(state.loops?.[0].learnings?.map((learning) => learning.lesson)).toEqual(["VAPOR_CANISTER：候选供应商全无带价"]);

    const html = renderLoops(state);
    const loopRunHtml = renderLoops(baseState({
      loops: [{ ...state.loops![0], projectId: "project-1" }],
    }));
    const emptyLearningsHtml = renderLoops(baseState({
      loops: [{ ...state.loops![0], learnings: [] }],
    }));

    expect(html).toContain("态势研判");
    expect(html).toContain("loop-judgment");
    expect(html).toContain("loop-judgment-line");
    expect(html).toContain(state.loops?.[0].summary.trend);
    expect(html).toContain('data-action="loop-run"');
    expect(html).toContain('data-loop-id="growth-loop"');
    expect(loopRunHtml).toContain('data-project-id="project-1"');
    expect(html.indexOf("loop-judgment")).toBeLessThan(html.indexOf('data-panel="overview"'));
    expect(html).toContain('data-panel="overview"');
    expect(html).toContain('data-panel="waves"');
    expect(html).toContain('data-panel="levers"');
    expect(html).toContain('data-panel="lessons"');
    expect(html).toContain("42");
    expect(html).toContain("激活率");
    expect(html).toContain("#1");
    expect(html).toContain("#2");
    expect(html).toContain("价格页标题");
    expect(html).toContain("首轮任务清单");
    expect(html).toContain("deploy-a");
    expect(html).toContain("deploy-b");
    expect(html).toContain("已验证");
    expect(html).toContain("待验证");
    expect(html).toContain("价格页实验");
    expect(html).toContain("新手引导");
    expect(html).toContain("投放素材");
    expect(html).toContain('data-status="active"');
    expect(html).toContain('data-status="needs-dev"');
    expect(html).toContain('data-status="honest-zero"');
    expect(html).toContain("loop-lever-next");
    expect(html).toContain('data-next-lever="true"');
    expect((html.match(/样本太小/g) ?? [])).toHaveLength(1);
    expect(html).toContain("移动端入口弱");
    expect(html).toContain("日志延迟");
    expect(html).toContain("已学到");
    expect(html.indexOf("经验 gotchas")).toBeLessThan(html.indexOf("已学到"));
    expect(html).toContain("VAPOR_CANISTER：候选供应商全无带价");
    expect(html).toContain('<span class="stage">弱项</span>');
    expect(emptyLearningsHtml).toContain('<div class="run empty"><span class="name">暂无沉淀</span></div>');
  });

  test("renderLoops keeps a stable empty-state structure", () => {
    const html = renderLoops(baseState({ loops: [] }));

    expect(html).toContain("暂无运营 loop");
    expect(html).not.toContain('data-action="loop-run"');
    expect(html).toContain('data-panel="overview"');
    expect(html).toContain('data-panel="waves"');
    expect(html).toContain('data-panel="levers"');
    expect(html).toContain('data-panel="lessons"');
  });

  test("renderLoops shows model token usage only when tokensByModel is non-empty", () => {
    const withUsage = renderLoops(baseState({
      loops: [],
      costSummary: costSummary({ "claude-opus-4-8": 12300 }),
    }));

    expect(withUsage).toContain("loop-usage");
    expect(withUsage).toContain("claude-opus-4-8");
    expect(withUsage).toContain("12.3k");

    const withoutUsage = renderLoops(baseState({
      loops: [],
      costSummary: costSummary({}),
    }));

    expect(withoutUsage).not.toContain("loop-usage");
  });

  test("collectState isolates LoopStore.list failures as an empty loops array", async () => {
    vi.spyOn(LoopStore.prototype, "list").mockRejectedValueOnce(new Error("boom"));

    const state = await collectState(new ArtifactStore(join(repo, ".kunpeng", "artifacts")), repo, { kunpengHome: repo });

    expect(state.systemLight).toBe("green");
    expect(state.loops).toEqual([]);
  });

  test("aggregateLoops collects loops across all project snapshots (multi-project 全局 #/loops)", () => {
    const lv = (id: string): LoopView => ({
      id, name: id.toUpperCase(), metric: { label: "x", current: 1 }, waveCount: 0,
      summary: { trend: "暂无 wave，x=1", recent: "—", blockers: "无明显卡点", next: "下一步：设定首个杠杆" },
      recent: [], leversByStatus: { active: [], needsDev: [], honestZero: [] }, gotchas: [],
    });
    const snap = (loops?: LoopView[]): ProjectSnapshot => ({ state: { loops } } as unknown as ProjectSnapshot);
    const result = aggregateLoops([snap([lv("a")]), snap([]), snap([lv("b")]), snap(undefined)]);
    expect(result.map((loop) => loop.id)).toEqual(["a", "b"]);
  });
});
