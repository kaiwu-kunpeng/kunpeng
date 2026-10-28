import { describe, it, expect } from "vitest";
import { renderWorkbenchPanel } from "../../src/server/ui/workbench-panel.js";
import { readFileSync } from "node:fs";

const panel = renderWorkbenchPanel("<p>x</p>");
const theme = readFileSync(new URL("../../src/server/ui/theme.ts", import.meta.url), "utf8");

/** 取出 <=768px 媒体查询块的内容(按大括号配平),确保规则确实在移动断点内。 */
function mobileBlock(src: string): string {
  const i = src.indexOf("@media (max-width:768px)");
  expect(i, "找不到 768px 媒体查询块").toBeGreaterThan(-1);
  const start = src.indexOf("{", i);
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error("媒体查询块括号不闭合");
}

describe("手机端触控目标与标题栏压行", () => {
  const wb = mobileBlock(panel);
  const th = mobileBlock(theme);

  it("标题栏文字标签在手机上收起(压行)", () => {
    expect(wb).toContain(".kp-lbl{display:none}");
    expect(wb).toContain(".kp-term-status span:not(.dot){display:none}");
  });

  it("对话窗控件触控高度抬到 32px 以上", () => {
    expect(wb).toMatch(/\.kp-term-bar \.kp-model[^}]*min-height:34px/);
    expect(wb).toMatch(/\.kp-win-close\{[^}]*min-height:34px/);
    expect(wb).toMatch(/\.kp-projection-switch button\{[^}]*min-height:32px/);
    expect(wb).toMatch(/\.kp-conv-search\{[^}]*min-height:36px/);
  });

  it("全站输入框/下拉/折叠标题在手机上不小于 36px", () => {
    expect(th).toMatch(/input\[type=search\][^}]*min-height:36px/);
    expect(th).toMatch(/summary\.section-h\{[^}]*min-height:36px/);
    expect(th).toMatch(/\.theme-toggle button\{[^}]*min-height:32px/);
  });

  it("token 用量计数没有被隐藏(手机上仍要看得到)", () => {
    expect(wb).not.toMatch(/\.kp-toks\{[^}]*display:none/);
  });

  it("新规则只作用于移动断点,不污染桌面态", () => {
    const desktopPart = panel.slice(0, panel.indexOf("@media (max-width:768px)"));
    expect(desktopPart).not.toContain(".kp-term-status span:not(.dot){display:none}");
  });
});