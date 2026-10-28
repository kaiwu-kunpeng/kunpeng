import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { renderWorkbenchPanel } from "../../src/server/ui/workbench-panel.js";

const body = String(clientScript).replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");

describe("工作台对话区守卫", () => {
  test("SPA 脚本语法有效(模板串转义未破坏)", () => {
    expect(() => new Function(body)).not.toThrow();
  });

  test("localfs 授权持久化 wiring 存在", () => {
    expect(body).toContain("function localfsDbOpen");
    expect(body).toContain("function localfsSaveHandle");
    expect(body).toContain("function localfsLoadHandle");
    expect(body).toContain("function localfsForgetHandle");
    expect(body).toContain('indexedDB.open("kp-localfs"');
    expect(body).toContain("queryPermission");
    expect(body).toContain("requestPermission");
    expect(body).toContain("localfsSaveHandle(");
    expect(body).toContain("localfsForgetHandle(");
  });

  test("防双开:会话去重聚焦 + 在飞标记 + 新建按钮节流", () => {
    expect(body).toContain("openingConvs");
    expect(body).toContain("scrollIntoView");
    expect(body).toMatch(/openingConvs\[id\]\s*=\s*1/);
    expect(body).toMatch(/delete openingConvs\[id\]/);
    expect(body).toMatch(/disabled\s*=\s*true/);
  });

  test("防回退守卫:高度锁+贴底跟滚+心跳消费端不许消失", () => {
    expect(body).toContain("function nearBottom");
    const panel = renderWorkbenchPanel("");
    expect(panel).toContain("max-height:calc(100vh - 214px)");
    expect(panel).toContain("height:64vh");
  });
});