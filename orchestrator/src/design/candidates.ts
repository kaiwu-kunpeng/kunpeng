// 设计候选生成 candidates —— 并行解析所有设计来源，按序包成带 index 的候选列表。
// 纯逻辑、零 LLM、确定性可验（C8）。跨模块仅 import type 自 ./contract.js（C1 单写者 / P7a ②④）。

import type {
  DesignSource,
  DesignSourceInput,
  DesignContract,
} from "./contract.js";

/** 带序号的设计候选：index（从 0 起，对应 sources 顺序）+ 解析出的契约。 */
export interface IndexedDesignCandidate {
  /** 候选序号，从 0 起，对应 sources 的原始顺序。 */
  index: number;
  /** 该来源解析出的契约。 */
  contract: DesignContract;
}

/**
 * 并行解析所有设计来源，产出按序编号的候选列表。
 *
 * - 用 Promise.all 并行调每个 source.resolve(input)。
 * - 结果按 sources 原始顺序包成 `{ index, contract }`，index 从 0 起。
 */
export async function generateCandidates(
  sources: DesignSource[],
  input: DesignSourceInput,
): Promise<IndexedDesignCandidate[]> {
  const resolved = await Promise.all(
    sources.map((source) => source.resolve(input)),
  );
  return resolved.map((candidate, index) => ({
    index,
    contract: candidate.contract,
  }));
}
