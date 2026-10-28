// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

type MarkdownWindow = typeof globalThis.window & { kpRenderMarkdown: (markdown: string) => string };

describe("U2 代码块(作者验收)", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
  });

  test("SPA 语法守卫", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("代码块结构 + 复制按钮标记在", () => {
    expect(clientScript).toContain("kp-code-copy");
    expect(clientScript).toContain("kp-code-block");
  });

  test("kpRenderMarkdown 围栏块仍渲染成 kp-md-code,且外层带复制块", () => {
    new Function(clientScript)();
    const md = (globalThis.window as MarkdownWindow).kpRenderMarkdown;
    const fence = String.fromCharCode(96, 96, 96);
    const out = md(fence + "js\nconst x = 1;\n" + fence);
    expect(out).toContain("kp-md-code");
    expect(out).toContain("kp-code-block");
    expect(out).toContain("kp-code-copy");
  });
});
