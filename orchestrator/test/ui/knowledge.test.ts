import { describe, expect, test } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import { renderKnowledge } from "../../src/server/ui/views/knowledge.js";

function fixture(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 0,
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
    code: {
      srcLines: 0,
      testLines: 0,
      passedLines: 0,
      inFlightLines: 0,
      completed: 0,
      running: 0,
      rolledBack: 0,
    },
    designCandidates: [],
    health: { alerts: [], running: 0, healthy: 0 },
    ...overrides,
  };
}

const state = fixture();

describe("renderKnowledge", () => {
  test("renders empty shell and controls for client-side loading", () => {
    const html = renderKnowledge(state);

    expect(html).toContain('<div class="body">');
    expect(html).toContain('<div class="wrap">');
    expect(html).toContain("知识库");
    expect(html).toContain("捕获 · 检索 · promote");
    expect(html).toContain("外部材料沉淀的知识卡片，可检索、可 promote 成长期可复用知识");
    expect(html).toContain('data-knowledge-capture-input');
    expect(html).toContain('data-action="knowledge-capture"');
    expect(html).toContain('data-knowledge-capture-url');
    expect(html).toContain('data-action="knowledge-capture-url"');
    expect(html).toContain('data-knowledge-input');
    expect(html).toContain('data-action="knowledge-search"');
    expect(html).toContain('data-action="knowledge-clear"');
    expect(html).toContain('id="knowledge-results"');
    expect(html).toContain('data-panel="knowledge"');
    expect(html).toContain("加载中");
    expect(html).not.toContain('data-capture="cap-b"');
    expect(html).not.toContain("暂无知识卡片");
  });
});

describe("knowledge route and sidebar", () => {
  test("renderViewFragment dispatches knowledge route before overview fallback", () => {
    const html = renderViewFragment(state, "#/knowledge");

    expect(html).toContain("知识库");
    expect(html).not.toContain("在跑什么");
  });

  test("renderSidebar 资料库(原知识库入口)指向 #/library 且可激活", () => {
    const html = renderSidebar(state, "library");

    expect(html).toContain('href="#/library"');
    expect(html).toMatch(/class="nav-item active"[\s\S]*?<span class="lbl">资料库<\/span>/);
    expect(html).not.toContain('href="#/knowledge"');
  });
});