import { clientSource } from "../helpers/client-source.js";
import { httpSource } from "../helpers/http-source.js";
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import type { DashboardState } from "../../src/server/state-types.js";
import { renderShell } from "../../src/server/ui/shell.js";

describe("前端三方库本地伺服", () => {
  it("五个 vendor 资产在仓内", () => {
    for (const f of ["cytoscape.min.js", "elk.bundled.js", "cytoscape-elk.js", "xterm.min.js", "xterm.min.css"]) {
      expect(existsSync(`assets/vendor/${f}`), f).toBe(true);
    }
  });

  it("http.ts 挂 /vendor/ 路由且带白名单", () => {
    const src = httpSource();
    const idx = src.indexOf("/vendor/");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(Math.max(0, idx - 2000), idx + 3000);
    expect(window).toContain("cytoscape.min.js");
    expect(window).toContain("xterm.min.css");
  });

  it("vendor 引用在懒加载器(client 源码),shell/client 均无外网 CDN", () => {
    const client = clientSource();
    expect(client).toContain("/vendor/cytoscape.min.js");
    expect(client).toContain("/vendor/xterm.min.js");
    const shell = renderShell({ humanGates: [], flows: [], artifacts: {} } as unknown as DashboardState);
    for (const banned of ["jsdelivr", "unpkg.com", "cdnjs"]) {
      expect(shell).not.toContain(banned);
      expect(client).not.toContain(banned);
    }
    expect(shell).not.toContain('<script src="/vendor/cytoscape.min.js"');
  });
});
