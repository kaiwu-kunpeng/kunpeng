import { describe, expect, test } from "vitest";
import { themeCss } from "../../src/server/ui/theme.js";
import { renderProject } from "../../src/server/ui/views/project.js";
import type { DashboardState } from "../../src/server/state.js";

const DEFINED = new Set([...themeCss.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));

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

function renderProduct(overrides: Partial<DashboardState> = {}): string {
  return renderProject(fixture(overrides), "kunpeng", "product", { projectName: "鲲鹏" });
}

function classesIn(html: string): Set<string> {
  const out = new Set<string>();
  for (const match of html.matchAll(/class="([^"$]+)"/g)) {
    for (const name of match[1].trim().split(/\s+/)) {
      if (name) out.add(name);
    }
  }
  return out;
}

function productContent(html: string): string {
  const start = html.indexOf('<div class="sec-h"><h3>产品定义');
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start);
}

describe("project product tab", () => {
  test("renders empty state with DEFINE start action", () => {
    const html = renderProduct();

    expect(html).toContain('class="interview"');
    expect(html).toContain('class="iv-input"');
    expect(html).toContain('data-action="product-start"');
    expect(html).toContain("发起 DEFINE 访谈");
    expect(html).toMatch(/class="tab active" href="#\/project\/kunpeng\/product">产品/);
    expect(html).not.toContain("未来");
  });

  test("renders in-progress interview state", () => {
    const html = renderProduct({
      productSession: {
        status: "in-progress",
        idea: "做个待办",
        answeredCount: 2,
        totalQuestions: 5,
        currentQuestion: "核心使用场景是什么？",
      },
    });

    expect(html).toContain('class="iv-progress"');
    expect(html).toContain("第 3/5 问");
    expect(html).toContain('class="iv-q"');
    expect(html).toContain("核心使用场景是什么？");
    expect(html).toContain('data-action="product-answer-submit"');
  });

  test("renders completed product definition without answer input", () => {
    const html = renderProduct({
      productSession: {
        status: "done",
        idea: "x",
        answeredCount: 5,
        totalQuestions: 5,
        definition: {
          idea: "x",
          problem: "P",
          users: ["U1"],
          stories: ["S1"],
          acceptance: ["A1", "A2"],
        },
      },
    });

    expect(html).toContain('class="pdef"');
    expect(html).toContain("P");
    expect(html).toContain("U1");
    expect(html).toContain("S1");
    expect(html).toContain("A1");
    expect(html).toContain("A2");
    expect(html).toContain("pdef-k");
    expect(html).toContain('data-action="product-to-spec"');
    expect(html).not.toContain("iv-input");
  });

  test("falls back to empty state when done session has no definition", () => {
    const html = renderProduct({
      productSession: {
        status: "done",
        idea: "x",
        answeredCount: 5,
        totalQuestions: 5,
      },
    });

    expect(html).toContain('data-action="product-start"');
    expect(html).toContain('class="iv-input"');
    expect(html).not.toContain('data-action="product-to-spec"');
  });

  test("uses only classes defined by themeCss for product states", () => {
    const states = [
      renderProduct(),
      renderProduct({
        productSession: {
          status: "in-progress",
          idea: "做个待办",
          answeredCount: 2,
          totalQuestions: 5,
          currentQuestion: "核心使用场景是什么？",
        },
      }),
      renderProduct({
        productSession: {
          status: "done",
          idea: "x",
          answeredCount: 5,
          totalQuestions: 5,
          definition: {
            idea: "x",
            problem: "P",
            users: ["U1"],
            stories: ["S1"],
            acceptance: ["A1", "A2"],
          },
        },
      }),
    ];

    for (const html of states) {
      const naked = [...classesIn(productContent(html))].filter((name) => !DEFINED.has(name));
      expect(naked, `产品 tab 用了无 CSS 的 class: ${naked.join(", ")}`).toEqual([]);
    }
  });
});
