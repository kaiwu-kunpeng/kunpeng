import { describe, it, expect } from "vitest";
import { synthesizeProposals } from "../src/research/synthesize.js";
import type { ResearchFinding } from "../src/research/types.js";

describe("synthesizeProposals · suggestedUpgrade", () => {
  it("对同时带 suggestedUpgrade 与 source 的 finding 产 upgrade 提案", () => {
    const findings: ResearchFinding[] = [
      {
        topic: "工具升级",
        source: "https://x.com/up",
        summary: "vitest 有新版",
        suggestedUpgrade: "升级 vitest 到 2.x",
      },
    ];

    const proposals = synthesizeProposals(findings);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].target).toBe("upgrade");
    expect(proposals[0].text).toBe("据 https://x.com/up 建议升级：升级 vitest 到 2.x");
    expect(proposals[0].source).toBe("research:https://x.com/up");
  });

  it("缺 suggestedUpgrade 或缺 source 时跳过", () => {
    const findings: ResearchFinding[] = [
      { topic: "无升级", source: "https://x.com/none", summary: "没有升级建议" },
      { topic: "无来源", source: "", summary: "有建议没来源", suggestedUpgrade: "升级 X" },
    ];

    const upgrades = synthesizeProposals(findings).filter((c) => c.target === "upgrade");

    expect(upgrades).toHaveLength(0);
  });
});
