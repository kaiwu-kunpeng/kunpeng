import { expect, test } from "vitest";
import { CodeGraphStore } from "../../src/codegraph/store.js";
import { CodeGraph } from "../../src/codegraph/graph.js";
import { estimateQuerySavings, formatSavings } from "../../src/codegraph/savings.js";

function fixture(): CodeGraphStore {
  const store = new CodeGraphStore();
  store.addNode({ id: "a", kind: "function", name: "mergeGate", file: "src/a.ts", line: 1 });
  store.addNode({ id: "b", kind: "function", name: "runMergeFlow", file: "src/b.ts", line: 5 });
  store.addEdge({ from: "b", to: "a", kind: "calls" });
  return store;
}

test("focused context saves tokens vs reading whole files (upper bound)", () => {
  const store = fixture();
  const graph = new CodeGraph(store);
  const e = estimateQuerySavings({ store, graph, query: "merge", sizeOf: () => 8000 });
  expect(e.nodes).toBeGreaterThan(0);
  expect(e.baselineTokens).toBeGreaterThan(e.focusedTokens);
  expect(e.savedTokens).toBe(e.baselineTokens - e.focusedTokens);
  expect(e.savedRatio).toBeGreaterThan(0);
  expect(e.savedRatio).toBeLessThanOrEqual(1);
});

test("no baseline file sizes -> zero savings, no divide-by-zero", () => {
  const store = fixture();
  const graph = new CodeGraph(store);
  const e = estimateQuerySavings({ store, graph, query: "merge", sizeOf: () => 0 });
  expect(e.savedTokens).toBe(0);
  expect(e.savedRatio).toBe(0);
});

test("formatSavings renders an explicitly labeled upper-bound report", () => {
  const store = fixture();
  const graph = new CodeGraph(store);
  const out = formatSavings(estimateQuerySavings({ store, graph, query: "merge", sizeOf: () => 8000 }));
  expect(out).toContain("省 token 估算");
  expect(out).toContain("上界");
  expect(out).toContain("省 ~");
});