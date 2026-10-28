import { describe, expect, it } from "vitest";

import { part05 } from "../../src/server/ui/client-parts/part05.js";

describe("终端 fit 时序修复(ResizeObserver)", () => {
  it("存在统一 fit 通道 termFitTab,含未排版守卫与尺寸同步", () => {
    expect(part05).toContain("function termFitTab(tab)");
    expect(part05).toMatch(/offsetWidth < 20 \|\| tab\.wrapEl\.offsetHeight < 20/);
    expect(part05).toContain('JSON.stringify({ type: "resize", cols: tab.term.cols, rows: tab.term.rows })');
  });

  it("每标签挂 ResizeObserver 并在销毁时 disconnect", () => {
    expect(part05).toContain("new ResizeObserver");
    expect(part05).toContain("ro.observe(wrap)");
    expect(part05).toContain("tab.ro.disconnect()");
  });
});