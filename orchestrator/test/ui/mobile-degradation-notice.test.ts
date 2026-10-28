import { describe, expect, it } from "vitest";

import { part04 } from "../../src/server/ui/client-parts/part04.js";
import { part05 } from "../../src/server/ui/client-parts/part05.js";

describe("移动端能力降级明确告知", () => {
  it("终端:hover:none 检测 + 状态栏与终端内双提示", () => {
    expect(part05).toContain('matchMedia("(hover: none)")');
    expect(part05).toContain("手机端终端体验受限");
    expect(part05).toContain("建议使用桌面浏览器操作终端");
  });

  it("localfs:不支持文案明确指向桌面 Chrome/Edge", () => {
    expect(part04).toContain("手机/平板浏览器均不支持");
    expect(part04).toContain("桌面版 Chrome 或 Edge");
  });
});