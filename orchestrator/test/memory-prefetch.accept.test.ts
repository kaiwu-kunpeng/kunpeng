import { describe, expect, it } from "vitest";
import { relevantExperiences } from "../src/loop/memory-recall.js";

describe("记忆预取(作者验收)", () => {
  const exps = [
    { title: "spec fence 坑", body: "accept 块漏收尾会静默无验收,写完必用 parseMethodPlan 自检 acceptanceCmd" },
    { title: "统计聚合教训", body: "聚合统计必须用落盘的真实模型标签,不要用静态表反推" },
    { title: "无关经验", body: "厨房烤箱预热到二百度" },
  ];

  it("按词重叠召回最相关经验,无关的不出现", () => {
    const out = relevantExperiences("修复统计聚合的真实模型标签回退逻辑", exps, 2);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toContain("统计");
    expect(out.join("\n")).not.toContain("烤箱");
  });

  it("零重叠返回空,空输入不抛", () => {
    expect(relevantExperiences("完全无关的主题词汇组合", [{ body: "xyz" }])).toEqual([]);
    expect(relevantExperiences("", [])).toEqual([]);
  });

  it("k 上限与格式", () => {
    const out = relevantExperiences("spec 验收 accept 统计 聚合 模型", exps, 1);
    expect(out.length).toBe(1);
    expect(out[0]).toMatch(/^【经验】/);
  });
});