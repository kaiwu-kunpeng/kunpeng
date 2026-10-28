import { describe, it, expect } from "vitest";
import { handleCodegraphMcp } from "../../src/codegraph/mcp-server.js";
import { CodeGraphStore } from "../../src/codegraph/store.js";

function textOf(res: unknown): string {
  const r = res as { result?: { content?: { text?: string }[] } };
  return r?.result?.content?.[0]?.text ?? "";
}

describe("A7 codegraph 多项目路由", () => {
  const main = new CodeGraphStore();
  main.addNode({ id: "m1", kind: "function", name: "mainOnlyFn", file: "a.ts", line: 1 });
  const p2 = new CodeGraphStore();
  p2.addNode({ id: "p1", kind: "function", name: "projTwoFn", file: "b.ts", line: 1 });
  const deps = { store: main, stores: new Map([["proj2", p2]]) };

  const search = (query: string, project?: string) =>
    handleCodegraphMcp(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "codegraph_search", arguments: project ? { query, project } : { query } } },
      deps,
    );

  it("不带 project → 主图", () => {
    expect(textOf(search("mainOnlyFn"))).toContain("mainOnlyFn");
    expect(textOf(search("projTwoFn"))).not.toContain("projTwoFn");
  });

  it("带 project=proj2 → 该项目图", () => {
    expect(textOf(search("projTwoFn", "proj2"))).toContain("projTwoFn");
    expect(textOf(search("mainOnlyFn", "proj2"))).not.toContain("mainOnlyFn");
  });

  it("带未知 project → 回落主图", () => {
    expect(textOf(search("mainOnlyFn", "nope"))).toContain("mainOnlyFn");
  });
});