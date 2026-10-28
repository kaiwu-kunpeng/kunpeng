import { describe, it, expect } from "vitest";
import { claudeAdapter, type AdapterRoute } from "../../src/agent/backend-adapter.js";
describe("claudeAdapter --mcp-config", () => {
  it("传 mcpConfigPath 时 args 含 --mcp-config 与 --strict-mcp-config", () => {
    const route: AdapterRoute = {};
    const inv = claudeAdapter.invoke(route, [], "/p/home/mcp.json");
    expect(inv.args).toContain("--mcp-config");
    expect(inv.args).toContain("/p/home/mcp.json");
    expect(inv.args).toContain("--strict-mcp-config");
  });
  it("不传则 args 不含 --mcp-config(向后兼容)", () => {
    const route: AdapterRoute = {};
    const inv = claudeAdapter.invoke(route, []);
    expect(inv.args).not.toContain("--mcp-config");
  });
});
