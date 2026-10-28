import { expect, test } from "vitest";
import { CodeGraphStore } from "../../src/codegraph/store.js";
import { impactedNodes } from "../../src/codegraph/impact.js";

function n(id: string, name: string) { return { id, kind: "function" as const, name, file: `${name}.ts`, line: 1 }; }

test("reverse-BFS finds upstream callers up to depth", () => {
  const s = new CodeGraphStore();
  s.addNode(n("a", "handler")); s.addNode(n("b", "service")); s.addNode(n("c", "repo"));
  s.addEdge({ from: "a", to: "b", kind: "calls" }); // handler -> service
  s.addEdge({ from: "b", to: "c", kind: "calls" }); // service -> repo
  const names = impactedNodes(s, "repo", 2).map((x) => x.name).sort();
  expect(names).toEqual(["handler", "service"]); // 改 repo 波及 service 和 handler
});

test("depth limits the walk", () => {
  const s = new CodeGraphStore();
  s.addNode(n("a", "handler")); s.addNode(n("b", "service")); s.addNode(n("c", "repo"));
  s.addEdge({ from: "a", to: "b", kind: "calls" });
  s.addEdge({ from: "b", to: "c", kind: "calls" });
  expect(impactedNodes(s, "repo", 1).map((x) => x.name)).toEqual(["service"]);
});