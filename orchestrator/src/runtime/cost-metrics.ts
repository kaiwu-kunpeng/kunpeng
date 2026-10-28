export interface StageCost {
  stage: string;
  llm: boolean;
  tokens?: number;
}

export interface CostSummary {
  totalStages: number;
  llmStages: number;
  deterministicStages: number;
  totalTokens: number;
  determinismRatio: number;
  savedLlmCalls: number;
}

export function summarizeCost(stages: StageCost[]): CostSummary {
  const totalStages = stages.length;
  const llmStages = stages.filter((stage) => stage.llm === true).length;
  const deterministicStages = totalStages - llmStages;
  const totalTokens = stages.reduce((sum, stage) => sum + (stage.tokens ?? 0), 0);

  return {
    totalStages,
    llmStages,
    deterministicStages,
    totalTokens,
    determinismRatio: totalStages > 0 ? deterministicStages / totalStages : 0,
    savedLlmCalls: deterministicStages,
  };
}

export function formatCostSummary(s: CostSummary): string {
  return `${s.totalStages} 阶段：${s.llmStages} 走 LLM / ${s.deterministicStages} 确定性（省 ${s.savedLlmCalls} 次 LLM，确定性占 ${(s.determinismRatio * 100).toFixed(0)}%），共 ${s.totalTokens} tokens`;
}
