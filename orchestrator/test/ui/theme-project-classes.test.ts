import { describe, expect, test } from "vitest";
import { themeCss } from "../../src/server/ui/theme.js";
import { renderOverview } from "../../src/server/ui/views/overview.js";
import { renderReviewInbox } from "../../src/server/ui/views/review-inbox.js";
import { renderProject } from "../../src/server/ui/views/project.js";
import { renderEvolution } from "../../src/server/ui/views/evolution.js";
import { renderLoops } from "../../src/server/ui/views/loops.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import type { DashboardState } from "../../src/server/state.js";

// 回归守卫（系统级）：cockpit 各批次反复出现「落了 class 名却没在 themeCss 写样式」——
// 测试只断言 HTML 含 class 字符串就全绿，但页面肉眼是裸的（字符串绿≠长得对）。
// 本测试把每个视图真渲染出来，抽出渲染结果里的 class，逐一断言 themeCss 有对应规则。

// themeCss 里已定义的 class 集合（从选择器抽 .name）。
const DEFINED = new Set([...themeCss.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));

// 豁免名单：这些 class 不需要自有规则——要么是叠在某基类上的 modifier（基类负责样式），
// 要么元素自带 inline style。新增豁免必须在此显式登记并说明原因。
const EXEMPT = new Set([
  "project-topbar", // 叠在 .topbar 上
  "project-tabs",   // 叠在 .tabs 上
  "project-wrap",   // 叠在 .wrap 上
  "inbox-head",     // 叠在 .section-h 上
  "overview-stats", // overview.ts 内联 style
  "caret",          // rail-foot 的 ▾ 字符，无需样式
  "success",        // hero/hero-badge 的 tone modifier；基类已默认 success 外观
  "kp-attn-badge",  // 服务端隐藏的 attention 标记；有值时 client 追加已有 .badge 外观
]);

function classesIn(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/class="([^"$]+)"/g)) {
    for (const t of m[1].trim().split(/\s+/)) if (t) out.add(t);
  }
  return out;
}

function richState(): DashboardState {
  return {
    agents: 2,
    flows: [{ flowId: "f1", requirement: "做点啥", stage: "done", status: "verified", agentActive: false, startedAt: 1, updatedAt: 2, history: [], light: "green" }] as DashboardState["flows"],
    running: [{ flowId: "f1", requirement: "做点啥", stage: "implement", status: "running", agentActive: true, startedAt: 1, updatedAt: 2, history: [], light: "green" }] as DashboardState["running"],
    blockers: [],
    humanGates: [{ what: "合并主干 (人工门#1)", detail: "kp/x → main", flowId: "x" }],
    artifacts: {},
    branches: ["kp/x"],
    statusCounts: { verified: 1 },
    systemLight: "green",
    agentAssignments: [{ agent: "主 agent", doing: "调度 1 条流" }],
    patrol: { pendingCount: 1, lastRunText: "上次巡检 @123" },
    plans: [{ id: "plan-1", status: "verified", merged: true, desc: "某方案", summary: "某方案", segmentCount: 1 }],
    code: { srcLines: 1, testLines: 1, passedLines: 2, inFlightLines: 0, completed: 1, running: 1, rolledBack: 0 },
    designCandidates: [{ index: 0, source: "claude", anchor: "a", png: "x.png" }],
    designSelected: "claude",
    health: { alerts: [], running: 1, healthy: 1 },
    main: { commit: "abc1234", subject: "改了点啥", committedText: "5 分钟前", mergedPlans: 1, staleBranches: 1 },
    activity: { total: 1, verified: 1, rolledBack: 0, successRate: 1, recent: [{ flowId: "f1", status: "verified", stage: "done", updatedAt: 2, agoText: "5 分钟前" }] },
    evolution: { lastRunText: "上次巡检 @123", pendingCount: 1, proposals: [{ id: "patrol-1", status: "draft", summary: "某提案", hasEvidence: true, holdoutPassK: 0.8 }], regression: { holdout: 3, optimization: 12 }, approvedCount: 1 },
    loops: [{
      id: "growth-loop",
      name: "增长运营 Loop",
      summary: { trend: "升", recent: "", blockers: "", next: "" },
      metric: { label: "激活率", current: 42 },
      waveCount: 2,
      recent: [
        { seq: 2, lever: "onboarding", subject: "首轮任务清单", metricDelta: 3, metricAfter: 42, deploy: "deploy-b", verified: false, agoText: "30 分钟前" },
        { seq: 1, lever: "pricing", subject: "价格页标题", metricDelta: 3, metricAfter: 39, deploy: "deploy-a", verified: true, agoText: "2 小时前" },
      ],
      leversByStatus: {
        active: [{ id: "pricing", label: "价格页实验", status: "active" }],
        needsDev: [{ id: "onboarding", label: "新手引导", status: "needs-dev" }],
        honestZero: [{ id: "ads", label: "投放素材", status: "honest-zero" }],
      },
      nextLever: { id: "onboarding", label: "新手引导", status: "needs-dev" },
      gotchas: ["样本太小", "移动端入口弱"],
    }],
  };
}

describe("所有视图渲染出的 class 都在 themeCss 里有样式（防裸页回归）", () => {
  const s = richState();
  const views: Record<string, string> = {
    sidebar: renderSidebar(s, "overview", { projects: [{ id: "kunpeng", name: "鲲鹏" }] }),
    overview: renderOverview(s),
    inbox: renderReviewInbox(s),
    "project/flows": renderProject(s, "kunpeng", "flows", { projectName: "鲲鹏" }),
    "project/plans": renderProject(s, "kunpeng", "plans", { projectName: "鲲鹏" }),
    "project/design": renderProject(s, "kunpeng", "design", { projectName: "鲲鹏" }),
    evolution: renderEvolution(s),
    loops: renderLoops(s),
  };

  for (const [name, html] of Object.entries(views)) {
    test(`${name}: 无裸 class`, () => {
      const used = classesIn(html);
      const naked = [...used].filter((c) => !DEFINED.has(c) && !EXEMPT.has(c));
      expect(naked, `视图 ${name} 用了无 CSS 的 class: ${naked.join(", ")}`).toEqual([]);
    });
  }
});
