import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

const body = String(clientScript).replace(/^\s*<script>/, "").replace(/<\/script>\s*$/, "");

describe("localfs 写入直达(预览/下载)", () => {
  test("SPA 脚本语法有效(模板串转义未破坏)", () => {
    expect(() => new Function(body)).not.toThrow();
  });

  test("localfsActionLinks helper 存在且构造 Blob objectURL + 下载属性", () => {
    expect(body).toContain("function localfsActionLinks");
    expect(body).toContain("URL.createObjectURL");
    expect(body).toContain("new Blob([op.content]");
    expect(body).toMatch(/download="' \+ escAttr\(nm\)/);
  });

  test("写成功后追加带链接的已写入行", () => {
    expect(body).toContain("localfsActionLinks(op)");
    expect((body.match(/localfsActionLinks\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test("html 按 text/html 预览,其余按纯文本", () => {
    expect(body).toContain("text/html");
    expect(body).toContain("text/plain;charset=utf-8");
  });

  test("既有守卫未被动过:回执/持久化/防双开/贴底跟滚仍在", () => {
    expect(body).toContain("function localfsNestWarn");
    expect(body).toContain("function localfsSaveHandle");
    expect(body).toContain("openingConvs");
    expect(body).toContain("function nearBottom");
  });

  test("无硬编码颜色(样式守卫)", () => {
    expect(body).not.toMatch(/localfsActionLinks[\s\S]{0,400}#[0-9a-fA-F]{3,6}/);
  });
});