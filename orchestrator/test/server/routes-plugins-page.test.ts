import { describe, it, expect } from "vitest";
import "../../src/server/routes/plugins-page.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";
import { renderPluginsPage } from "../../src/server/routes/plugins-page.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import type { DashboardState } from "../../src/server/state.js";

describe("X2:cockpit 插件与 MCP 只读页", () => {
  it("注册了 GET /plugins", () => {
    expect(listModularRoutes().some((r) => r.method === "GET" && r.path === "/plugins")).toBe(true);
  });

  it("渲染两张表并全转义", () => {
    const html = renderPluginsPage({
      plugins: [{ name: "demo-pack", version: "1.0.0", enabled: true, dir: "/x/<b>demo</b>", skills: 2, mcp: 1 }],
      servers: [{ id: "codegraph", transport: "stdio", enabled: true, origin: "user", detail: "node x.js" }],
    });
    expect(html).toContain("demo-pack");
    expect(html).toContain("codegraph");
    expect(html).toContain("&lt;b&gt;");
    expect(html.includes("<b>demo</b>")).toBe(false);
    expect(html).toContain("plugins-skills-mcp.md");
  });

  it("空态给出配置指引", () => {
    const html = renderPluginsPage({ plugins: [], servers: [] });
    expect(html).toContain("kunpeng plugin add");
    expect(html).toContain("kunpeng mcp add");
  });

  it("侧栏出现插件入口", () => {
    const html = renderSidebar({ humanGates: [], flows: [], artifacts: {} } as unknown as DashboardState, "overview");
    expect(html).toContain('href="/plugins"');
    expect(html).toContain("插件");
  });
});