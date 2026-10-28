import { describe, expect, it } from "vitest";
import { extractAcceptanceCriteria } from "../../src/server/pre-review.js";

// 全部取自 .kunpeng/artifacts/ 里真实 kind:spec 产物的标题形态
const TIER2_CASES: [string, string][] = [
  ["## 可客观判定的验收标准", "甲条"],
  ["### 交付物与验收标准", "乙条"],
  ["## Spec 摘要（验收标准，可客观判定）", "丙条"],
  ["**锁定验收测试**", "丁条"],
  ["## 4. 验收标准（可客观判定）", "戊条"],
  ["### 行为验收标准", "己条"],
  ["## 客观验收标准", "庚条"],
];

describe("二级：标题含「验收」但不以它开头", () => {
  for (const [heading, body] of TIER2_CASES) {
    it(`认得 ${heading}`, () => {
      const doc = ["# 文档标题", "", "## 实现要求", "- 无关内容", "", heading, `- ${body}`, "", "## 之后", "尾巴"].join("\n");
      const out = extractAcceptanceCriteria(doc);
      expect(out).toContain(body);
      expect(out).not.toContain("无关内容");
      expect(out).not.toContain("尾巴");
    });
  }
});

describe("一级优先（防回归的关键）", () => {
  it("一级与二级并存时必须用一级", () => {
    const doc = [
      "# F46 把验收强度闸挂到作者手写的 spec 上",
      "- 这是文档开头的无关叙述",
      "",
      "## 验收标准（可客观判定）",
      "- 真正的验收条目",
      "",
      "## 之后",
      "尾巴",
    ].join("\n");
    const out = extractAcceptanceCriteria(doc);
    expect(out).toContain("真正的验收条目");
    expect(out).not.toContain("这是文档开头的无关叙述");
  });

  it("范围段提到验收时不得抢在真验收段之前", () => {
    const doc = [
      "## 改动面（scope allow 四文件 + 验收测试）",
      "- 范围描述",
      "",
      "**验收标准**",
      "- 真正的验收条目",
      "",
      "**约束**",
      "尾巴",
    ].join("\n");
    const out = extractAcceptanceCriteria(doc);
    expect(out).toContain("真正的验收条目");
    expect(out).not.toContain("范围描述");
  });
});

describe("一级标题（# 开头）不参与二级匹配", () => {
  it("只有一级标题含验收时不抽它，回落 testCmd", () => {
    const doc = ["# Spec: 修正写错的验收断言", "- 正文若干"].join("\n");
    const out = extractAcceptanceCriteria(doc, "cd orchestrator && npx tsc --noEmit");
    expect(out).toContain("npx tsc --noEmit");
    expect(out).not.toContain("正文若干");
  });

  it("只有一级标题含验收且无 testCmd 时返回空串", () => {
    expect(extractAcceptanceCriteria("# Spec: 修正写错的验收断言\n- 正文若干")).toBe("");
  });
});

describe("既有一级行为不变", () => {
  it("**验收标准** 仍照旧", () => {
    const doc = ["**目标**", "- 做事", "", "**验收标准**", "- 第一条", "", "**约束**", "尾巴"].join("\n");
    const out = extractAcceptanceCriteria(doc);
    expect(out).toContain("第一条");
    expect(out).not.toContain("尾巴");
  });

  it("## 验收标准（可客观判定） 仍照旧，且遇围栏即停", () => {
    const doc = ["## 验收标准（可客观判定）", "- 甲", "```accept", "不该被吞", "```"].join("\n");
    const out = extractAcceptanceCriteria(doc);
    expect(out).toContain("甲");
    expect(out).not.toContain("不该被吞");
  });

  it("**验收测试（作者亲写，锁定落盘）** 仍照旧", () => {
    const doc = ["**验收测试（作者亲写，锁定落盘）**", "- 锁定断言", "", "**约束**", "尾巴"].join("\n");
    const out = extractAcceptanceCriteria(doc);
    expect(out).toContain("锁定断言");
    expect(out).not.toContain("尾巴");
  });
});

describe("防回归：非标题行的一级写法必须仍能抽到", () => {
  // 这四种取自真实语料，共 114 份；给一级加「必须是标题行」守卫会全部丢失
  it("普通行带冒号：验收标准：", () => {
    const doc = ["# 标题", "- 无关", "", "验收标准：", "- 真条目", "", "## 之后", "尾巴"].join("\n");
    const out = extractAcceptanceCriteria(doc);
    expect(out).toContain("真条目");
    expect(out).not.toContain("无关");
  });

  it("粗体后带冒号：**验收标准（可客观判定）**：", () => {
    const doc = ["**目标**", "- 无关", "", "**验收标准（可客观判定）**：", "- 真条目", "", "**约束**", "尾巴"].join("\n");
    const out = extractAcceptanceCriteria(doc);
    expect(out).toContain("真条目");
    expect(out).not.toContain("无关");
  });

  it("粗体后带半角括号与冒号：**验收标准**(客观可判):", () => {
    const doc = ["**目标**", "- 无关", "", "**验收标准**(客观可判):", "- 真条目", "", "**约束**", "尾巴"].join("\n");
    const out = extractAcceptanceCriteria(doc);
    expect(out).toContain("真条目");
    expect(out).not.toContain("无关");
  });

  it("同一行就带正文：验收标准：实现只能改 xxx", () => {
    const doc = ["# 标题", "- 无关", "", "验收标准：实现只能改 http.ts 加一行", "", "## 之后", "尾巴"].join("\n");
    const out = extractAcceptanceCriteria(doc);
    expect(out).toContain("实现只能改 http.ts");
    expect(out).not.toContain("无关");
  });

  it("非标题的一级写法优先于标题式的二级写法", () => {
    const doc = ["## 改动面（含验收测试）", "- 范围", "", "**验收标准（可客观判定）**：", "- 真条目", "", "**约束**", "尾巴"].join("\n");
    const out = extractAcceptanceCriteria(doc);
    expect(out).toContain("真条目");
    expect(out).not.toContain("范围");
  });
});

describe("边界不变", () => {
  it("完全没有验收字样时返回空串", () => {
    expect(extractAcceptanceCriteria("# 标题\n正文")).toBe("");
  });

  it("空输入返回空串且不抛", () => {
    expect(extractAcceptanceCriteria("")).toBe("");
  });

  it("结果不超过 4000 字符", () => {
    const huge = "## 可客观判定的验收标准\n" + "- 很长的一条\n".repeat(3000);
    expect(extractAcceptanceCriteria(huge).length).toBeLessThanOrEqual(4000);
  });
});