import { describe, it, expect } from "vitest";
import { synthesizeProposals } from "../src/research/synthesize.js";
import type { ResearchFinding } from "../src/research/types.js";

describe("synthesizeProposals", () => {
  it("仅保留带 suggestedConvention 且带 source 的 finding，映射为 conventions 提案", () => {
    const findings: ResearchFinding[] = [
      {
        topic: "测试组织",
        source: "https://x.com/best",
        summary: "把测试与实现放一起",
        suggestedConvention: "co-locate 测试与实现",
      },
      {
        topic: "缺约定",
        source: "https://x.com/none",
        summary: "没有可落地约定",
      },
    ];

    const proposals = synthesizeProposals(findings);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].target).toBe("conventions");
    expect(proposals[0].text).toContain("co-locate 测试");
    expect(proposals[0].text).toContain("https://x.com/best");
    expect(proposals[0].source).toContain("https://x.com/best");
  });
});
