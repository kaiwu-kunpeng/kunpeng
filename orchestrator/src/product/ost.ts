import type {
  ProductDiscovery,
  RiceScore,
  OpportunitySolutionTree,
  OstValidation,
} from "./contract.js";

export function buildOstPrompt(discovery: ProductDiscovery): string {
  return [
    "请基于以下 DISCOVER 产物构建 Opportunity Solution Tree。",
    "先给出一个 North Star outcome 和一个领先 metric。",
    "再列出机会节点：机会层只表达定性机会，禁打分，不要包含 importance、satisfaction、score、rice 等打分字段。",
    "每个机会必须包含来源 source 和 evidence=real|synthetic；来源可来自访谈、数据、竞品、合成假设等 provenance。",
    "解法放入 solutions 层，挂到合法 opportunityId，后续才可做 RICE。",
    "只输出单行 JSON，形状必须是：",
    '{"northStar":{"outcome":"","metric":""},"opportunities":[{"id":"","statement":"","source":"","evidence":"real"}],"solutions":[{"id":"","opportunityId":"","idea":""}]}',
    `jobStatement: ${discovery.jobStatement}`,
    `targetUsers: ${JSON.stringify(discovery.targetUsers)}`,
    `alternatives: ${JSON.stringify(discovery.alternatives)}`,
    `opportunities: ${JSON.stringify(discovery.opportunities)}`,
  ].join("\n");
}

export function riceScore(reach: number, impact: number, confidence: number, effort: number): RiceScore {
  const c = confidence > 1 ? confidence / 100 : confidence;
  const rawScore = effort > 0 ? (reach * impact * c) / effort : 0;
  const score = Math.round(rawScore * 100) / 100;
  return { reach, impact, confidence: c, effort, score };
}

export function validateOst(tree: OpportunitySolutionTree): OstValidation {
  const errors: string[] = [];

  if (!tree.northStar.outcome.trim()) {
    errors.push("North Star outcome 不能为空");
  }
  if (!tree.northStar.metric.trim()) {
    errors.push("North Star metric 不能为空");
  }

  for (const opportunity of tree.opportunities) {
    if (!opportunity.id.trim()) {
      errors.push("机会 id 不能为空");
    }
    if (!opportunity.statement.trim()) {
      errors.push(`机会 ${opportunity.id || "<missing>"} statement 不能为空`);
    }
    if (!opportunity.source.trim()) {
      errors.push(`机会 ${opportunity.id || "<missing>"} 必须包含来源 provenance`);
    }
    if (opportunity.evidence !== "real" && opportunity.evidence !== "synthetic") {
      errors.push(`机会 ${opportunity.id || "<missing>"} evidence 必须是 real 或 synthetic`);
    }
  }

  const opportunityIds = new Set(tree.opportunities.map((opportunity) => opportunity.id));
  for (const solution of tree.solutions) {
    if (!opportunityIds.has(solution.opportunityId)) {
      errors.push(`解法 ${solution.id || "<missing>"} 挂载的 opportunityId 不存在`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    requiresHumanGate:
      tree.opportunities.some((opportunity) => opportunity.evidence === "synthetic") ||
      tree.opportunities.length > 1,
  };
}
