import { describe, it, expect } from "vitest";
import { handleCodegraphMcp } from "../../src/codegraph/mcp-server.js";
import { CodeGraphStore } from "../../src/codegraph/store.js";
import { emptyCallStats, bumpCall } from "../../src/codegraph/call-stats.js";

describe("A5 codegraph 调用计数", () => {
  it("emptyCallStats 是空的", () => {
    const s = emptyCallStats();
    expect(s.total).toBe(0);
    expect(s.calls).toEqual({});
  });

  it("bumpCall 累加且不可变", () => {
    const s0 = emptyCallStats();
    const s1 = bumpCall(s0, "codegraph_search");
    const s2 = bumpCall(bumpCall(s1, "codegraph_search"), "codegraph_callers");
    expect(s2.calls["codegraph_search"]).toBe(2);
    expect(s2.calls["codegraph_callers"]).toBe(1);
    expect(s2.total).toBe(3);
    expect(s0.total).toBe(0);
    expect(s0.calls).toEqual({});
  });

  it("handleCodegraphMcp 对已知工具触发 recordCall", () => {
    const store = new CodeGraphStore();
    const seen: string[] = [];
    const req = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/call",
      params: { name: "codegraph_search", arguments: { query: "x" } },
    };
    const res = handleCodegraphMcp(req, { store, recordCall: (t) => seen.push(t) });
    expect(seen).toEqual(["codegraph_search"]);
    expect(res?.error).toBeUndefined();
  });

  it("未知工具与 tools/list 都不计数", () => {
    const store = new CodeGraphStore();
    const seen: string[] = [];
    handleCodegraphMcp(
      { jsonrpc: "2.0" as const, id: 2, method: "tools/call", params: { name: "nope", arguments: {} } },
      { store, recordCall: (t) => seen.push(t) },
    );
    handleCodegraphMcp(
      { jsonrpc: "2.0" as const, id: 3, method: "tools/list" },
      { store, recordCall: (t) => seen.push(t) },
    );
    expect(seen).toEqual([]);
  });
});