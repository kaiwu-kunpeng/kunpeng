import { expect, test } from "vitest";
import { CodeGraphStore } from "../../src/codegraph/store.js";
import type { CodeNode } from "../../src/codegraph/types.js";

function n(id: string, name: string, kind: CodeNode["kind"] = "function"): CodeNode {
  return { id, kind, name, file: `${name}.ts`, line: 1 };
}

test("callers/callees walk the call graph", () => {
  const g = new CodeGraphStore();
  g.addNode(n("a", "login"));
  g.addNode(n("b", "validate"));
  g.addNode(n("c", "hashPassword"));
  g.addEdge({ from: "a", to: "b", kind: "calls" });
  g.addEdge({ from: "b", to: "c", kind: "calls" });

  const callersOfValidate = g.callers("validate").map((x) => x.name);
  expect(callersOfValidate).toContain("login");

  const calleesOfValidate = g.callees("validate").map((x) => x.name);
  expect(calleesOfValidate).toContain("hashPassword");
});

test("addNode upserts by id (no duplicates)", () => {
  const g = new CodeGraphStore();
  g.addNode(n("a", "login"));
  g.addNode({ ...n("a", "login"), line: 42 });
  expect(g.stats().nodes).toBe(1);
});

test("search is case-insensitive substring on name, sorted", () => {
  const g = new CodeGraphStore();
  g.addNode(n("a", "UserService"));
  g.addNode(n("b", "userRepo"));
  g.addNode(n("c", "OrderService"));
  const hits = g.search("user").map((x) => x.name);
  expect(hits).toEqual(["UserService", "userRepo"]);
});

test("toJSON/fromJSON round-trips the graph", () => {
  const g = new CodeGraphStore();
  g.addNode(n("a", "login"));
  g.addNode(n("b", "validate"));
  g.addEdge({ from: "a", to: "b", kind: "calls" });
  const back = CodeGraphStore.fromJSON(g.toJSON());
  expect(back.stats()).toEqual({ nodes: 2, edges: 1 });
  expect(back.callers("validate").map((x) => x.name)).toContain("login");
});