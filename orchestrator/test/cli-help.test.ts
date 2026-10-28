import { describe, it, expect } from "vitest";
import { wantsHelp, usageText } from "../src/cli.js";

describe("wantsHelp", () => {
  it("含 --help / -h → true", () => {
    expect(wantsHelp(["patrol", "--help"])).toBe(true);
    expect(wantsHelp(["-h"])).toBe(true);
    expect(wantsHelp(["run", "需求", "--help"])).toBe(true);
  });
  it("不含 → false", () => {
    expect(wantsHelp(["patrol"])).toBe(false);
    expect(wantsHelp([])).toBe(false);
    expect(wantsHelp(["scout", "--topic", "x"])).toBe(false);
  });
});

describe("usageText", () => {
  it("补入漏列的顶层命令", () => {
    const t = usageText();
    for (const c of ["autopilot", "maintain", "status", "flywheel", "best-of-n", "workspace", "codegraph"]) {
      expect(t).toContain(c);
    }
  });
  it("resume 去重，只出现一次", () => {
    expect((usageText().match(/\bresume\b/g) ?? []).length).toBe(1);
  });
});