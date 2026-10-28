import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cliSource } from "../helpers/cli-source.js";

describe("maintain/apply 接线（源码级断言）", () => {
  const src = cliSource();

  it("maintain 分支接了 landing + apply 自动化，且支持 --scan-only", () => {
    const idx = src.indexOf('name: "maintain"');
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 6000);
    expect(window).toContain("landApprovedChannelProposals");
    expect(window).toContain("runApplyApprovedLive");
    expect(window).toContain("--scan-only");
  });

  it("apply 分支委托 runApplyApprovedLive，原主体已搬到 apply-live", () => {
    const idx = src.indexOf('name: "apply"');
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 1200);
    expect(window).toContain("runApplyApprovedLive");
    const live = readFileSync("src/evolution/apply-live.ts", "utf8");
    expect(live).toContain("applyApprovedProposals");
    expect(live).toContain("conventions.md");
    expect(live).toContain("compileAll");
  });
});
