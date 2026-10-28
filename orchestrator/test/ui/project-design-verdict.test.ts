import { describe, expect, test } from "vitest";
import { themeCss } from "../../src/server/ui/theme.js";
import { renderProject } from "../../src/server/ui/views/project.js";
import type { DashboardState, DesignVerdictView } from "../../src/server/state.js";

const DEFINED = new Set([...themeCss.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));
const EXEMPT = new Set([
  "project-topbar",
  "project-tabs",
  "project-wrap",
]);

function classesIn(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/class="([^"$]+)"/g)) {
    for (const t of m[1].trim().split(/\s+/)) if (t) out.add(t);
  }
  return out;
}

function fixture(designVerdict?: DesignVerdictView): DashboardState {
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
    designCandidates: [{ index: 0, source: "claude", anchor: "a", png: "x.png" }],
    designSelected: "claude",
    designVerdict,
    health: { alerts: [], running: 0, healthy: 0 },
  };
}

function render(designVerdict?: DesignVerdictView): string {
  return renderProject(fixture(designVerdict), "kunpeng", "design", { projectName: "鲲鹏" });
}

describe("project design verdict gate bar", () => {
  test("renders human review verdict with all passing signals and no blockers", () => {
    const html = render({
      tier1AutoPass: false,
      needsHumanReview: true,
      blockers: [],
      a11yGateable: true,
      perfWithinBudget: true,
      visualMatchesBaseline: true,
      hasNewOrChangedBaseline: true,
    });

    expect(html).toContain('class="gate-bar"');
    expect(html).toContain("gate-pill gate-review");
    expect(html).toContain("⏳ 待人审");
    expect(html.match(/sig-ok/g)).toHaveLength(3);
    expect(html).not.toContain("gate-blockers");
  });

  test("renders blocked verdict with blocker reason and mixed signals", () => {
    const html = render({
      tier1AutoPass: false,
      needsHumanReview: false,
      blockers: ["a11y 不可门"],
      a11yGateable: false,
      perfWithinBudget: true,
      visualMatchesBaseline: true,
      hasNewOrChangedBaseline: false,
    });

    expect(html).toContain("gate-pill gate-block");
    expect(html).toContain("✗ 拦截");
    expect(html).toContain("gate-blockers");
    expect(html).toContain("a11y 不可门");
    expect(html).toContain('<span class="sig sig-bad">a11y ✗</span>');
    expect(html).toContain('<span class="sig sig-ok">perf ✓</span>');
    expect(html).toContain('<span class="sig sig-ok">视觉 ✓</span>');
  });

  test("renders auto pass verdict", () => {
    const html = render({
      tier1AutoPass: true,
      needsHumanReview: false,
      blockers: [],
      a11yGateable: true,
      perfWithinBudget: true,
      visualMatchesBaseline: true,
      hasNewOrChangedBaseline: true,
    });

    expect(html).toContain("gate-pill gate-pass");
    expect(html).toContain("✓ 自动放行");
  });

  test("does not render gate bar when verdict is absent but keeps candidates", () => {
    const html = render();

    expect(html).not.toContain("gate-bar");
    expect(html).toContain("cands");
  });

  test("uses only theme-defined classes in blocked verdict render", () => {
    const html = render({
      tier1AutoPass: false,
      needsHumanReview: false,
      blockers: ["a11y 不可门"],
      a11yGateable: false,
      perfWithinBudget: true,
      visualMatchesBaseline: true,
      hasNewOrChangedBaseline: false,
    });

    for (const className of classesIn(html)) {
      expect(DEFINED.has(className) || EXEMPT.has(className), `.${className} is not defined in themeCss`).toBe(true);
    }
  });
});
