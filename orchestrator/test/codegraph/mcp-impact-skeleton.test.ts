import { describe, it, expect } from "vitest";
import { handleCodegraphMcp, CODEGRAPH_TOOLS } from "../../src/codegraph/mcp-server.js";
import { CodeGraphStore } from "../../src/codegraph/store.js";

function makeStore(): CodeGraphStore {
  const store = new CodeGraphStore();
  store.addNode({ id: "callerFn", kind: "function", name: "callerFn", file: "caller.ts", line: 1 });
  store.addNode({ id: "leafFn", kind: "function", name: "leafFn", file: "leaf.ts", line: 1 });
  store.addEdge({ from: "callerFn", to: "leafFn", kind: "calls" });
  return store;
}

function toolText(res: unknown): string {
  return String((res as { result?: { content?: Array<{ text?: string }> } })?.result?.content?.[0]?.text ?? "");
}

describe("codegraph impact/skeleton MCP 工具", () => {
  it("tools/list 含 impact 与 skeleton", () => {
    const names = CODEGRAPH_TOOLS.map((tool) => tool.name);
    expect(names).toContain("codegraph_impact");
    expect(names).toContain("codegraph_skeleton");
  });

  it("codegraph_impact 返回上游调用者", () => {
    const res = handleCodegraphMcp(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "codegraph_impact", arguments: { name: "leafFn" } } },
      { store: makeStore() },
    );
    expect(toolText(res)).toContain("callerFn");
  });

  it("codegraph_skeleton 输出符号大纲", () => {
    const res = handleCodegraphMcp(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "codegraph_skeleton", arguments: {} } },
      { store: makeStore() },
    );
    const text = toolText(res);
    expect(text).toContain("function callerFn @ caller.ts:1");
    expect(text).toContain("function leafFn @ leaf.ts:1");
  });

  it("recordCall 被调用", () => {
    let recorded = "";
    handleCodegraphMcp(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "codegraph_skeleton", arguments: {} } },
      { store: makeStore(), recordCall: (tool) => { recorded = tool; } },
    );
    expect(recorded).toBe("codegraph_skeleton");
  });
});