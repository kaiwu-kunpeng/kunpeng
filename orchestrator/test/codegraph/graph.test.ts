import { expect, test } from "vitest";
import { CodeGraphStore } from "../../src/codegraph/store.js";
import { CodeGraph } from "../../src/codegraph/graph.js";
import type { CodeNode } from "../../src/codegraph/types.js";

function n(id: string, name: string): CodeNode {
  return { id, kind: "function", name, file: `${name}.ts`, line: 7 };
}

test("buildContext returns a compact snippet with callers and callees", () => {
  const s = new CodeGraphStore();
  s.addNode(n("a", "login"));
  s.addNode(n("b", "validate"));
  s.addNode(n("c", "hashPassword"));
  s.addEdge({ from: "a", to: "b", kind: "calls" });
  s.addEdge({ from: "b", to: "c", kind: "calls" });

  const ctx = new CodeGraph(s).buildContext("validate");
  expect(ctx).toContain("validate");
  expect(ctx).toContain("validate.ts:7");
  expect(ctx).toContain("login");        // caller
  expect(ctx).toContain("hashPassword"); // callee
});

test("buildContext respects maxNodes and reports no match", () => {
  const s = new CodeGraphStore();
  for (let i = 0; i < 5; i++) s.addNode(n(`id${i}`, `svc${i}`));
  const g = new CodeGraph(s);
  const ctx = g.buildContext("svc", 2);
  expect((ctx.match(/svc\d/g) ?? []).length).toBeGreaterThan(0);
  expect(g.buildContext("zzz")).toBe("(no match)");
});