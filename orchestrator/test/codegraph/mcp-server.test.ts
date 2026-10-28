import { expect, test } from "vitest";
import { CodeGraphStore } from "../../src/codegraph/store.js";
import { CODEGRAPH_TOOLS, handleCodegraphMcp } from "../../src/codegraph/mcp-server.js";

type ToolListResult = { tools: Array<{ name: string }> };
type ToolCallResult = { content: Array<{ text: string }> };

function store(): CodeGraphStore {
  const s = new CodeGraphStore();
  s.addNode({ id: "a", kind: "function", name: "login", file: "a.ts", line: 1 });
  s.addNode({ id: "b", kind: "function", name: "validate", file: "a.ts", line: 2 });
  s.addEdge({ from: "a", to: "b", kind: "calls" });
  return s;
}

test("tools/list returns the six codegraph tools", () => {
  const res = handleCodegraphMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { store: store() });
  const names = (res!.result as ToolListResult).tools.map((tool) => tool.name).sort();
  expect(names).toEqual([
    "codegraph_callees",
    "codegraph_callers",
    "codegraph_context",
    "codegraph_impact",
    "codegraph_search",
    "codegraph_skeleton",
  ]);
  expect(CODEGRAPH_TOOLS.length).toBe(6);
});

test("tools/call codegraph_callers returns the caller", () => {
  const res = handleCodegraphMcp(
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "codegraph_callers", arguments: { name: "validate" } } },
    { store: store() },
  );
  const text = (res!.result as ToolCallResult).content[0].text;
  expect(text).toContain("login");
});

test("tools/call codegraph_context renders a snippet", () => {
  const res = handleCodegraphMcp(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "codegraph_context", arguments: { query: "validate" } } },
    { store: store() },
  );
  const text = (res!.result as ToolCallResult).content[0].text;
  expect(text).toContain("validate");
  expect(text).toContain("login");
});

test("unknown tool yields a JSON-RPC error", () => {
  const res = handleCodegraphMcp(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } },
    { store: store() },
  );
  expect(res!.error?.code).toBe(-32601);
});
