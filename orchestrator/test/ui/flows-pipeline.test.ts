import { describe, expect, test } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
import { clientScript } from "../../src/server/ui/client.js";

function base(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 0, flows: [], running: [], blockers: [], humanGates: [], artifacts: {},
    branches: [], statusCounts: {}, systemLight: "green", agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" }, plans: [],
    code: { srcLines: 0, testLines: 0, passedLines: 0, inFlightLines: 0, completed: 0, running: 0, rolledBack: 0 },
    designCandidates: [], health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  } as DashboardState;
}

const flow = (o: Record<string, unknown>) => ({
  flowId: "f1", requirement: "通讯面板", stage: "implement", status: "running",
  agentActive: true, startedAt: 1000, updatedAt: 5000, light: "green",
  history: [{ stage: "spec", at: 1000 }, { stage: "implement", at: 3000 }],
  ...o,
});

describe("开发流 · 流水线视图", () => {
  test("渲染 5 段流水线 + 每段标签", () => {
    const html = renderViewFragment(
      base({ flows: [flow({ stageBackends: { implement: "codex" }, stageTokens: { implement: 12300 } }) as never] }),
      "#/project/kunpeng/flows", { projectName: "kunpeng" },
    );
    expect(html).toContain('class="pl"');
    for (const s of ["spec", "audit", "implement", "verify", "commit"]) expect(html).toContain(`>${s}</span>`);
    // 当前段 implement 应为 active
    expect(html).toMatch(/seg act[\s\S]*?implement/);
    // 后端/token 微标签
    expect(html).toContain("seg-meta");
    expect(html).toContain("12,300");
  });

  test("verified 流挂门徽章插槽 + 合并按钮", () => {
    const html = renderViewFragment(
      base({ flows: [flow({ flowId: "fv", stage: "verify", status: "verified" }) as never] }),
      "#/project/kunpeng/flows", { projectName: "kunpeng" },
    );
    expect(html).toContain('data-gate-diag="fv"');
    expect(html).toContain('data-action="merge-main"');
  });

  test("blocker / humanGate 内联红条;按 planId 分组", () => {
    const html = renderViewFragment(
      base({ flows: [
        flow({ flowId: "fb", blocker: "审计未过", planId: "plan-X", phase: 1 }) as never,
        flow({ flowId: "fg", planId: "plan-X", phase: 2, humanGate: { gate: "合并主干", what: "kp/x → main" } }) as never,
      ] }),
      "#/project/kunpeng/flows", { projectName: "kunpeng" },
    );
    expect(html).toContain("卡点 · 审计未过");
    expect(html).toContain("需人工 · 合并主干");
    expect(html).toContain("方案 plan-X");
  });

  test("client 接线:flows 路由 ~4s 轮询", () => {
    expect(clientScript).toContain("flowsPollTimer");
    expect(clientScript).toContain("/project");
    expect(clientScript).toContain("4000");
  });
});
