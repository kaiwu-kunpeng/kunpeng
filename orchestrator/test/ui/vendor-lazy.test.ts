import { describe, it, expect } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { renderShell } from "../../src/server/ui/shell.js";
import { SERVICE_WORKER } from "../../src/server/pwa.js";

describe("vendor 按视图懒加载", () => {
  it("壳不再急加载任何 vendor 脚本,保留 xterm css", () => {
    const src = renderShell.toString();
    expect(src.includes('script src="/vendor/')).toBe(false);
    expect(src.includes("/vendor/xterm.min.css")).toBe(true);
  });

  it("client 有按需加载器与全部五个资源路径", () => {
    expect(clientScript).toContain("function kpLoadScript");
    expect(clientScript).toContain("function kpEnsureVendor");
    expect(clientScript).toContain('"/vendor/cytoscape.min.js"');
    expect(clientScript).toContain('"/vendor/elk.bundled.js"');
    expect(clientScript).toContain('"/vendor/cytoscape-elk.js"');
    expect(clientScript).toContain('"/vendor/xterm.min.js"');
    expect(clientScript).toContain('"/vendor/xterm-addon-fit.min.js"');
  });

  it("架构与终端入口走 ensure 门,原初始化体保留", () => {
    expect(clientScript).toContain('kpEnsureVendor("graph")');
    expect(clientScript).toContain('kpEnsureVendor("term")');
    expect(clientScript).toContain("function initArchitectureNow");
    expect(clientScript).toContain("function initTerminalNow");
  });

  it("SW install 预热 vendor 缓存且失败不阻塞", () => {
    expect(SERVICE_WORKER).toContain("addAll");
    expect(SERVICE_WORKER).toContain('"/vendor/elk.bundled.js"');
    expect(SERVICE_WORKER).toContain("kp-vendor-v1");
  });

  it("模板串安全:client/sw 无反引号无插值", () => {
    expect(clientScript.includes("`")).toBe(false);
    expect(SERVICE_WORKER.includes("`")).toBe(false);
    expect(SERVICE_WORKER.includes("${")).toBe(false);
  });
});