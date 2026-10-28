import { describe, it, expect } from "vitest";
import { geoPrompt, parseGeoAnswer, summarizeGeoWave } from "./core.js";

const config = { brandNames: ["DemoTravel"], brandDomains: ["demo-travel.ai"] };

describe("geoPrompt", () => {
  it("含问题/品牌/JSON 指令", () => {
    const p = geoPrompt("How do foreigners get a SIM card in China?", config);
    expect(p).toContain("SIM card");
    expect(p).toContain("DemoTravel");
    expect(p).toContain("demo-travel.ai");
    expect(p).toContain("citedDomains");
    expect(p).toContain("mentionedBrand");
  });
});

describe("parseGeoAnswer", () => {
  it("正常解析 + 域名归一 + 品牌域名兜底判提及", () => {
    const text = '前置噪声 {"summary":"s","citedDomains":["https://Demo-Travel.AI/faq","china-briefing.com","china-briefing.com"],"mentionedBrand":false} tokens used: 500';
    const a = parseGeoAnswer("q1", text, config);
    expect(a.mentioned).toBe(true);
    expect(a.citedDomains).toContain("demo-travel.ai/faq");
    expect(new Set(a.citedDomains).size).toBe(a.citedDomains.length);
    expect(a.error).toBeUndefined();
  });

  it("解析失败 fail-safe", () => {
    const a = parseGeoAnswer("q2", "not json at all", config);
    expect(a.mentioned).toBe(false);
    expect(a.error).toBe("unparseable");
  });
});

describe("summarizeGeoWave", () => {
  it("统计与内容缺口", () => {
    const s = summarizeGeoWave([
      { question: "q1", mentioned: true, citedDomains: ["demo-travel.ai"] },
      { question: "q2", mentioned: false, citedDomains: ["china-briefing.com", "reddit.com", "x.com"] },
      { question: "q3", mentioned: false, citedDomains: [], error: "unparseable" },
    ]);
    expect(s.mentions).toBe(1);
    expect(s.total).toBe(3);
    expect(s.errors).toBe(1);
    expect(s.gaps.length).toBe(1);
    expect(s.gaps[0]).toContain("内容缺口");
    expect(s.gaps[0]).toContain("china-briefing.com");
  });
});
