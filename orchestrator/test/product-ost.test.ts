import { describe, expect, it, test } from "vitest";
import type { AgentRunner } from "../src/agent/runner.js";
import type { OpportunitySolutionTree, ProductDefinition, ProductDiscovery } from "../src/product/contract.js";
import { buildOstPrompt, riceScore, validateOst } from "../src/product/ost.js";
import { discoverOst, parseOstTree } from "../src/product/stages.js";

const definition: ProductDefinition = {
  idea: "待办协作",
  problem: "团队任务分散",
  users: ["项目经理"],
  stories: ["作为项目经理，我要看到任务状态"],
  acceptance: ["能创建任务"],
};

const discovery: ProductDiscovery = {
  definition,
  jobStatement: "当项目推进时，项目经理要掌握任务进展",
  targetUsers: ["项目经理"],
  alternatives: ["表格"],
  opportunities: [{ outcome: "减少漏跟进", importance: 9, satisfaction: 3, opportunityScore: 15 }],
  syntheticEvidence: true,
};

const OST_JSON = JSON.stringify({
  northStar: { outcome: "外国人快速办妥事", metric: "完成办事的周活" },
  opportunities: [{ id: "o1", statement: "签证流程复杂", source: "访谈", evidence: "real" }],
  solutions: [{ id: "s1", opportunityId: "o1", idea: "一站式签证指南" }],
});

const stubRunner = (text: string): AgentRunner => ({ run: async () => ({ text, meta: {} }) });

function validTree(): OpportunitySolutionTree {
  return {
    northStar: { outcome: "项目经理持续掌握任务进展", metric: "每日查看任务状态的项目占比" },
    opportunities: [
      {
        id: "opp-1",
        statement: "项目经理需要更早发现卡住的任务",
        source: "customer-interview-1",
        evidence: "real",
      },
    ],
    solutions: [{ id: "sol-1", opportunityId: "opp-1", idea: "任务风险列表" }],
  };
}

test("riceScore 计算 + confidence 百分比归一", () => {
  expect(riceScore(1000, 2, 80, 4)).toEqual({
    reach: 1000,
    impact: 2,
    confidence: 0.8,
    effort: 4,
    score: 400,
  });
  expect(riceScore(1000, 2, 0.8, 0).score).toBe(0);
});

test("validateOst 放行合法树", () => {
  const result = validateOst(validTree());

  expect(result.ok).toBe(true);
  expect(result.requiresHumanGate).toBe(false);
});

test("机会缺 source 不合法", () => {
  const tree = validTree();
  tree.opportunities[0]!.source = "";

  const result = validateOst(tree);

  expect(result.ok).toBe(false);
  expect(result.errors.some((error) => error.includes("来源") || error.includes("provenance"))).toBe(true);
});

test("解法挂不存在机会不合法", () => {
  const tree = validTree();
  tree.solutions[0]!.opportunityId = "missing-opp";

  const result = validateOst(tree);

  expect(result.ok).toBe(false);
});

test("合成证据→需人工门", () => {
  const tree = validTree();
  tree.opportunities[0]!.evidence = "synthetic";

  expect(validateOst(tree).requiresHumanGate).toBe(true);
});

test("多机会→需人工门(选择)", () => {
  const tree = validTree();
  tree.opportunities.push({
    id: "opp-2",
    statement: "负责人需要更少手动同步状态",
    source: "support-log-1",
    evidence: "real",
  });

  expect(validateOst(tree).requiresHumanGate).toBe(true);
});

test("buildOstPrompt 含 North Star/禁打分/来源/JSON 锚", () => {
  const prompt = buildOstPrompt(discovery);

  expect(prompt).toContain("North Star");
  expect(prompt.includes("禁打分") || prompt.includes("不要打分")).toBe(true);
  expect(prompt).toContain("来源");
  expect(prompt).toContain("JSON");
});

describe("parseOstTree", () => {
  it("解析出 northStar/opportunities/solutions", () => {
    const t = parseOstTree(OST_JSON);
    expect(t.northStar.outcome).toBe("外国人快速办妥事");
    expect(t.opportunities[0]!.id).toBe("o1");
    expect(t.opportunities[0]!.evidence).toBe("real");
    expect(t.solutions[0]!.opportunityId).toBe("o1");
  });

  it("缺字段给安全默认(evidence 默认 synthetic)", () => {
    const t = parseOstTree('{"opportunities":[{"id":"o1","statement":"x","source":"s"}]}');
    expect(t.opportunities[0]!.evidence).toBe("synthetic");
    expect(t.northStar.outcome).toBe("");
    expect(t.northStar.metric).toBe("");
    expect(t.solutions).toEqual([]);
  });

  it("产出可过 validateOst", () => {
    expect(validateOst(parseOstTree(OST_JSON)).ok).toBe(true);
  });

  it("解法挂不存在机会 → validateOst 报错", () => {
    const bad = parseOstTree(
      JSON.stringify({
        northStar: { outcome: "o", metric: "m" },
        opportunities: [{ id: "o1", statement: "s", source: "src", evidence: "real" }],
        solutions: [{ id: "s1", opportunityId: "GHOST", idea: "i" }],
      }),
    );
    expect(validateOst(bad).ok).toBe(false);
  });
});

describe("discoverOst", () => {
  it("跑 runner → 解析成 OST 树", async () => {
    const t = await discoverOst(discovery, stubRunner(OST_JSON));
    expect(t.northStar.metric).toBe("完成办事的周活");
    expect(t.solutions).toHaveLength(1);
  });

  it("runner 无文本 → 抛", async () => {
    const emptyRunner: AgentRunner = { run: async () => ({ text: "", meta: {} }) };
    await expect(discoverOst(discovery, emptyRunner)).rejects.toThrow(
      "discoverOst: 无法从 agent 输出解析 OST 树",
    );
  });
});
