import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderWorkbenchPanel } from "../../src/server/ui/workbench-panel.js";

function mobileBlock(src: string): string {
  const i = src.indexOf("@media (max-width:768px)");
  expect(i).toBeGreaterThan(-1);
  const start = src.indexOf("{", i);
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error("块不闭合");
}

const wb = mobileBlock(renderWorkbenchPanel("<p>x</p>"));
const th = mobileBlock(readFileSync(new URL("../../src/server/ui/theme.ts", import.meta.url), "utf8"));

describe("手机端触控目标补漏", () => {
  it("发送按钮 ≥36px(最高频按钮)", () => {
    expect(wb).toMatch(/\.kp-send\{[^}]*min-height:36px/);
  });
  it("窗口内折叠标题 ≥34px", () => {
    expect(wb).toMatch(/\.kp-win summary\{[^}]*min-height:34px/);
  });
  it("帮助图标热区 ≥34px", () => {
    expect(wb).toMatch(/\.kp-term-bar \.kp-help\{[^}]*min-height:34px/);
  });
  it("more 链接 ≥34px", () => {
    expect(wb).toMatch(/a\.more[^}]*min-height:34px/);
  });
  it("交换机紧急勾选项 ≥34px", () => {
    expect(th).toMatch(/label\.muted\{[^}]*min-height:34px/);
  });
});