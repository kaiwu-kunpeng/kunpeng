// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

type MarkdownRenderer = (markdown: string) => string;
type MarkdownWindow = typeof globalThis.window & { kpRenderMarkdown: MarkdownRenderer };

function runInDom(): MarkdownRenderer {
  document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
  // 执行 SPA 脚本(IIFE);它把 kpRenderMarkdown 挂到全局 window
  new Function(clientScript)();
  return (globalThis.window as MarkdownWindow).kpRenderMarkdown;
}

describe("对话 Markdown 渲染(作者验收)", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
  });

  test("SPA 语法守卫:clientScript 可被 new Function 解析", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("kpRenderMarkdown 暴露且渲染常见构造", () => {
    const md = runInDom();
    expect(typeof md).toBe("function");
    expect(md("## 标题")).toContain("<h");
    expect(md("- a\n- b")).toContain("<li");
    expect(md("**粗**")).toContain("<strong>");
    expect(md("`码`")).toContain("<code");
    const fence = String.fromCharCode(96, 96, 96);
    expect(md(fence + "js\nconst x=1;\n" + fence)).toContain("kp-md-code");
    expect(md("[k](https://ex.com)")).toContain("<a ");
  });

  test("安全:危险协议不成链,原始 HTML 被转义", () => {
    const md = runInDom();
    expect(md("[x](javascript:alert(1))")).not.toContain("<a ");
    expect(md("<script>bad()</script>")).toContain("&lt;script");
    expect(md("<script>bad()</script>")).not.toContain("<script>");
  });
});
