import { describe, expect, test } from "vitest";
import type { DashboardState } from "../../src/server/state.js";
import { renderViewFragment } from "../../src/server/ui/render-view.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import { renderReviewInbox } from "../../src/server/ui/views/review-inbox.js";

function fixture(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    agents: 0,
    flows: [],
    running: [],
    blockers: [],
    humanGates: [
      { what: "合并主干 kp/x → main", detail: "d", flowId: "flow-1" },
      { what: "批准进化提案 (人工门#2)", detail: "prop-9", flowId: "prop-9" },
    ],
    artifacts: {
      release: [
        { id: "release-vx", kind: "release", status: "draft", summary: "build: npm run build" },
      ],
      connector: [
        { id: "conn-1", kind: "connector", status: "draft", summary: "connector 动作：调用退款 connector" },
      ],
    },
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

describe("renderReviewInbox", () => {
  test("renders merge, proposal, release, and connector review items", () => {
    const html = renderReviewInbox(fixture());

    expect(html).toContain("待我处理");
    expect(html).toContain("合并确认");
    expect(html).toContain("进化提案批准");
    expect(html).toContain("发布确认");
    expect(html).toContain("高风险动作放行");
    expect(html).toContain('data-action="merge-main"');
    expect(html).toContain('data-flow="flow-1"');
    expect(html).toContain('data-action="autopilot"');
    expect(html).toContain("一键自动合并全部");
    expect(html).not.toContain("⚡");
    expect(html).toContain('data-action="approve-apply"');
    expect(html).toContain('data-id="prop-9"');
    expect(html).toContain('data-action="confirm-release"');
    expect(html).toContain('data-id="release-vx"');
    expect(html).toContain('data-action="approve-connector"');
    expect(html).toContain('data-id="conn-1"');
    expect(html).toContain('class="b pri"');
    expect(html).not.toContain('class="b app"');
    expect(html).toContain("调用退款 connector");
  });

  test("prefers reviewQueue and routes each card by project", () => {
    const html = renderReviewInbox(fixture({
      humanGates: [],
      artifacts: {},
      reviewQueue: [
        { projectId: "proj-a", projectName: "A", kind: "merge", id: "f1", title: "合并主干", detail: "d" },
        { projectId: "proj-b", projectName: "B", kind: "connector", id: "conn-b", title: "conn-b", detail: "退款" },
      ],
    }));

    expect(html).toContain('<span class="tag">A</span>');
    expect(html).toContain('<span class="tag">B</span>');
    expect(html).toContain('data-project="proj-a" data-flow="f1"');
    expect(html).toContain('data-action="merge-main" data-flow="f1" data-project="proj-a"');
    expect(html).toContain('data-action="autopilot"');
    expect(html).toContain("一键自动合并全部");
    expect(html).not.toContain("⚡");
    expect(html).toContain('data-project="proj-b" data-id="conn-b"');
    expect(html).toContain('data-action="approve-connector" data-id="conn-b" data-project="proj-b"');
    expect(html).toMatch(/<h3>待我处理<\/h3>\s*<span class="cnt">2<\/span>/);
    expect(html).not.toContain('class="b app"');
  });

  test("does not render confirm-release for verified releases", () => {
    const html = renderReviewInbox(fixture({
      artifacts: {
        release: [
          { id: "release-vx", kind: "release", status: "draft", summary: "build: npm run build" },
          { id: "release-done", kind: "release", status: "verified", summary: "already shipped" },
        ],
        connector: [
          { id: "conn-1", kind: "connector", status: "draft", summary: "connector 动作：调用退款 connector" },
        ],
      },
    }));

    expect(html).toContain('data-action="confirm-release" data-id="release-vx"');
    expect(html).not.toContain('data-action="confirm-release" data-id="release-done"');
    expect(html).not.toContain("already shipped");
  });

  test("renders empty state when all review queues are empty", () => {
    const html = renderReviewInbox(fixture({ humanGates: [], artifacts: {} }));

    expect(html).toContain("暂无待处理的门");
    expect(html).not.toContain('data-action="autopilot"');
  });

  test("does not render autopilot button when reviewQueue has no merge items", () => {
    const html = renderReviewInbox(fixture({
      humanGates: [],
      artifacts: {},
      reviewQueue: [
        { projectId: "proj-b", projectName: "B", kind: "connector", id: "conn-b", title: "conn-b", detail: "退款" },
      ],
    }));

    expect(html).toContain("高风险动作放行");
    expect(html).not.toContain('data-action="autopilot"');
  });

  test("renderViewFragment dispatches review-inbox route to the new view", () => {
    const html = renderViewFragment(fixture(), "#/review-inbox");

    expect(html).toContain("待我处理");
    expect(html).toContain("四类人审一个入口");
    expect(html).not.toContain("在跑什么");
  });

  test("sidebar inbox nav 指向 #/inbox,无 review-inbox 可点链接,徽标合计四类队列", () => {
    const html = renderSidebar(fixture(), "inbox");

    expect(html).toContain('href="#/inbox"');
    expect(/<a[^>]*href="#\/review-inbox"/.test(html)).toBe(false);
    expect(html).not.toContain("review-inbox");
    expect(html).toContain('<span class="badge">4</span>');
  });
});