import { describe, it, expect } from "vitest";
import { assessConcreteness } from "../../src/product/concreteness.js";
import type { ProductDefinition } from "../../src/product/contract.js";

function def(over: Partial<ProductDefinition>): ProductDefinition {
  return {
    idea: "某个想法",
    problem: "客户每天要手工核对 300 张发票，平均耗时 2 小时且易错",
    users: ["财务专员"],
    stories: ["当财务专员导入发票时，系统自动比对并标出差异"],
    acceptance: ["核对耗时从 2 小时降到 10 分钟以内"],
    jobStatement: "当我拿到一批发票时，我要快速找出差异，以便按时结账",
    nonGoals: ["不做报税"],
    ...over,
  } as unknown as ProductDefinition;
}

function fields(d: ProductDefinition): string[] {
  return assessConcreteness(d).issues.map((i) => i.field);
}

describe("空串数组不再蒙混过关", () => {
  it("stories 全空白判为缺失", () => {
    expect(fields(def({ stories: [""] }))).toContain("stories");
  });

  it("acceptance 全空白判为缺失", () => {
    expect(fields(def({ acceptance: ["   "] }))).toContain("acceptance");
  });

  it("nonGoals 全空白判为缺失", () => {
    expect(fields(def({ nonGoals: [""] }))).toContain("nonGoals");
  });

  it("空洞定义整体不通过", () => {
    expect(assessConcreteness(def({ stories: [""], acceptance: [""] })).pass).toBe(false);
  });
});

describe("套话判据不再因为长度而永不触发", () => {
  const longBuzz = "我们要打造闭环的一站式平台，赋能全体用户，无缝提升效率并优化体验，实现全方位的价值创造与生态协同";

  it("超过 40 字符的长套话仍被命中", () => {
    expect(longBuzz.length).toBeGreaterThan(40);
    expect(fields(def({ problem: longBuzz }))).toContain("problem");
  });

  it("含数字的描述不判套话", () => {
    const withNumber = longBuzz + "，目标是把耗时从 120 分钟降到 10 分钟";
    const problemIssues = assessConcreteness(def({ problem: withNumber })).issues
      .filter((i) => i.field === "problem" && i.problem.includes("套话"));
    expect(problemIssues).toEqual([]);
  });

  it("含「当…时」场景的描述不判套话", () => {
    const withScenario = "当财务专员在月末结账时，一站式赋能无缝提升效率并优化体验打造闭环的完整解决方案";
    const problemIssues = assessConcreteness(def({ problem: withScenario })).issues
      .filter((i) => i.field === "problem" && i.problem.includes("套话"));
    expect(problemIssues).toEqual([]);
  });
});

describe("不误杀合法定义", () => {
  it("字段齐备且具体的定义通过", () => {
    expect(assessConcreteness(def({})).pass).toBe(true);
  });
});