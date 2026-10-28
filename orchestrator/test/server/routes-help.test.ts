import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../src/server/routes/help.js";
import { listModularRoutes } from "../../src/server/routes/registry.js";
import { mdToHtml, resolveHelpPage } from "../../src/server/routes/help.js";
import { renderSidebar } from "../../src/server/ui/sidebar.js";
import type { DashboardState } from "../../src/server/state.js";

describe("H5:cockpit 帮助入口", () => {
  it("注册了 GET /help", () => {
    expect(listModularRoutes().some((r) => r.method === "GET" && r.path === "/help")).toBe(true);
  });

  it("mdToHtml 子集转换且全转义", () => {
    const html = mdToHtml("# 标题\n\n- 条目一\n\n**粗** 与 `code`\n\n```\n<script>alert(1)</script>\n```");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<li>条目一</li>");
    expect(html).toContain("<strong>粗</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("&lt;script&gt;");
    expect(html.includes("<script>")).toBe(false);
  });

  it("resolveHelpPage 防穿越", () => {
    const helpDir = mkdtempSync(join(tmpdir(), "kp-help-"));
    mkdirSync(join(helpDir, "01-getting-started"), { recursive: true });
    writeFileSync(join(helpDir, "README.md"), "# 帮助", "utf8");
    expect(resolveHelpPage(helpDir, null)).toContain("README.md");
    expect(resolveHelpPage(helpDir, "01-getting-started/what-is-kunpeng.md")).toContain("what-is-kunpeng.md");
    expect(resolveHelpPage(helpDir, "../../etc/passwd")).toBeNull();
    expect(resolveHelpPage(helpDir, "/etc/passwd.md")).toBeNull();
    expect(resolveHelpPage(helpDir, "a.txt")).toBeNull();
  });

  it("侧栏出现帮助入口", () => {
    const html = renderSidebar({ humanGates: [], flows: [], artifacts: {} } as unknown as DashboardState, "overview");
    expect(html).toContain('href="/help"');
    expect(html).toContain("帮助");
  });
});