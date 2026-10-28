import { expect, test } from "vitest";
import { slimFlowsForDashboard, type FlowWithLight } from "../../src/server/state.js";

function flow(index: number, requirement = "x".repeat(320)): FlowWithLight {
  return {
    flowId: `flow-${index}`,
    requirement,
    stage: "done",
    status: "verified",
    agentActive: false,
    startedAt: 1000 - index,
    updatedAt: 2000 - index,
    history: [],
    light: "green",
  };
}

test("slimFlowsForDashboard keeps the first 40 sorted flows and truncates long requirements by default", () => {
  const flows = Array.from({ length: 50 }, (_, index) => flow(index, `${index}-` + "a".repeat(320)));

  const slimmed = slimFlowsForDashboard(flows);

  expect(slimmed).toHaveLength(40);
  expect(slimmed.map((item) => item.flowId)).toEqual(flows.slice(0, 40).map((item) => item.flowId));
  for (const item of slimmed) {
    expect(item.requirement.length).toBeLessThanOrEqual(201);
    expect(item.requirement.endsWith("…")).toBe(true);
  }
});

test("slimFlowsForDashboard honors custom recentN and previewLen", () => {
  const flows = Array.from({ length: 50 }, (_, index) => flow(index));

  const slimmed = slimFlowsForDashboard(flows, { recentN: 5, previewLen: 10 });

  expect(slimmed).toHaveLength(5);
  for (const item of slimmed) {
    expect(item.requirement.length).toBeLessThanOrEqual(11);
    expect(item.requirement.endsWith("…")).toBe(true);
  }
});

test("slimFlowsForDashboard preserves short and undefined requirements", () => {
  const short = flow(1, "short requirement");
  const withoutRequirement = { ...flow(2), requirement: undefined } as unknown as FlowWithLight;

  const slimmed = slimFlowsForDashboard([short, withoutRequirement], { previewLen: 200 });

  expect(slimmed[0].requirement).toBe("short requirement");
  expect(slimmed[1].requirement).toBeUndefined();
});

test("slimFlowsForDashboard does not mutate the input array or flow objects", () => {
  const longRequirement = "full requirement ".repeat(30);
  const flows = Array.from({ length: 3 }, (_, index) => flow(index, longRequirement));
  const originalArray = [...flows];
  const originalFirst = { ...flows[0] };

  const slimmed = slimFlowsForDashboard(flows, { recentN: 2, previewLen: 10 });

  expect(flows).toEqual(originalArray);
  expect(flows[0]).toEqual(originalFirst);
  expect(flows[0].requirement).toBe(longRequirement);
  expect(slimmed[0]).not.toBe(flows[0]);
  expect(slimmed[0].requirement).not.toBe(longRequirement);
});
